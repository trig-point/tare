## Context

A premise probe of main (a14d70f) found that logging by grams already works by arithmetic: USDA and Open Food Facts rows in the source cache are stored per 100 g, so `log_food` with a `source_food_id` and `servings = grams / 100` gives the right numbers (`packages/engine/src/logging/intake.ts:46-50`). Three things stand in the way of logging a photographed meal honestly:

1. An entry that references a food inherits the food's provenance, and asking for `estimated` fails with `provenance_mismatch` (`packages/engine/src/logging/provenance.ts:12-20`). A referenced entry also cannot carry `kcal_low` and `kcal_high` (`packages/engine/src/logging/schemas.ts:76-83`). So a USDA Foundation food in an estimated amount can only be logged as `verified` with no range, which overstates its certainty.
2. Lookups match names exactly (`packages/nutrition/src/identity.ts:35-40`), so a USDA search for "rice" returns `no_match` and caches nothing. That rule exists so a generic food is never silently substituted; raw and cooked white rice differ by nearly three times in kcal per 100 g.
3. Nothing accepts an image. Every operation parses JSON with body limits from 1 to 16 KiB, and `/mcp` caps at 64 KiB (`packages/engine/src/mcp/server.ts:144-148`).

The intake table allows a referenced entry with provenance `estimated` and a range (`packages/engine/migrations/0002_core_schema.sql:53-81`), but it has no way to say that the amount, not the food, is the estimate; an approach review on Nov 19 required that state to be stored, not inferred.

## Goals / Non-Goals

**Goals:**
- An agent can turn "rice 300 g, teriyaki chicken 170 g" into logged entries whose per-gram values come from a chosen USDA food and whose amounts are marked as estimates with a range.
- The amount can be corrected later (after weighing) without losing the link to the food.
- The PWA can propose the parts from a photo, using a vision model chosen by a spike.
- Vision models only name foods and estimate grams. Tare does every calorie and macro calculation.

**Non-Goals:**
- Showing ranges in the ledger or on Today.
- Storing photos, or estimating volume from depth sensors.
- Calibrating estimates against the weight trend (a separate ticket).
- Logging by grams against a volume basis (no density table exists).

## Decisions

### D1. An estimated amount of a referenced food
An additive migration adds `amount_estimated` (integer 0 or 1, default 0), `servings_low` and `servings_high` (nullable REAL) to `intake_entries`, with CHECKs: the servings bounds are both null or both set, set only when `amount_estimated` is 1 and the row references a food, and `0 < servings_low <= servings <= servings_high`. Existing rows read as `amount_estimated = 0`. The generated queries and the strict intake row schema change together.

`log_food` with a `food_id` or `source_food_id` accepts `amount_estimated: true` and an optional `servings_low` and `servings_high` (both or neither). The snapshot is computed from the food exactly as today. When `amount_estimated` is true, the entry's provenance is `estimated` whatever the food's provenance, and `kcal_low` and `kcal_high` are the food's per-serving kcal (or, when the food has its own range, its low and high) times `servings_low` and `servings_high`. Without a servings range the bounds are null, and adaptive TDEE applies its default range as it does for any estimated entry. A food with unknown kcal gives null bounds. A requested `provenance` that differs from the food's still fails with `provenance_mismatch`; the estimate is expressed only by `amount_estimated`.

Edits always recompute from one source, the current food, as `edit_intake` already does for servings (`packages/engine/src/logging/operations.ts:139-150`):
- New `servings`, or new `servings_low` and `servings_high`, on an estimated-amount entry recompute the snapshot and the bounds from the current food. Stale bounds are never scaled.
- `amount_measured: true` (with or without new `servings`) recomputes the snapshot at the given or stored servings, restores the food's provenance and any range the food itself carries, sets `amount_estimated` to 0 and clears the servings bounds.

An estimated-amount entry never consumes pantry stock: the pantry design says never consume a guessed amount, so the entry records a stock outcome of not consumed. A later `amount_measured` edit does not consume retroactively.

The existing HTTP test that expects `provenance_mismatch` for a verified USDA reference logged with `provenance: "estimated"` stays as it is, because that request is still refused; the new path is the `amount_estimated` flag.

Alternative considered: ad hoc entries with server-computed numbers, the FDC id in `source` and grams in `portion_note`. It needs no writer change, but it drops the food reference, and `edit_intake` refuses `servings` on ad hoc entries, so a later weighing could not correct the amount. Rejected because correcting the amount is the point. Inferring the state from "provenance differs from the food's" was also rejected: an owned food can already be `estimated`, and `edit_food` can change a food's provenance later.

### D2. Candidate search and pick by id
Two agent operations sit beside `search_online` and use the existing USDA adapter:
- `search_food_candidates { query, limit }` (limit 1 to 10, default 10) returns USDA hits with a mass basis, Foundation and SR Legacy first and then Branded, each with its FDC id, name, data type, brand and kcal per 100 g. It writes nothing.
- `add_source_food { fdc_id }` fetches that one record with `fetchById`, stores it in the shared source cache like any adapter result, and returns its `source_food_id`. Repeating it returns the same row.

The exact-match rule for automatic lookups stays: these are explicit lookups, and the caller chooses. Open Food Facts is left out because its ids are barcodes, which is weak for generic foods.

### D3. `log_meal_parts`
Input: `client_id` (1 to 100 characters), optional `eaten_at`, optional `meal_note` (up to 200 characters), and 1 to 12 parts. Each part has exactly one of `food_id` or `source_food_id`, `grams` (greater than 0), and an optional `grams_low` and `grams_high` (both or neither, `0 < grams_low <= grams <= grams_high`). The request body limit is 8192 bytes on HTTP; a 12-part request with the longest client id and note fits with room to spare.

A migration adds `meal_receipts` (person, client id, a hash of the normalized request, created time; unique per person and client id) and `meal_receipt_parts` (receipt, position, intake entry id). Part `n` is written with the intake client id `meal-part:<receipt id>:<n>`, and ordinary intake writes refuse client ids starting with `meal-part:`, so the two can never collide.

Everything happens in one `writeTransaction`, with one `eaten_at` captured for the meal:
1. Look up the receipt. If one exists with the same hash, return its parts in order and write nothing. If the hash differs, answer 409 `mutation_conflict`. If a recorded part has since been deleted, answer 409 `meal_part_deleted`.
2. Read each part's food (an owned food scoped to the caller, or a shared source food) once, and use that same row for the conversion and the snapshot. Grams become servings with `servingsFor` against the food's basis. A missing food, a volume or count basis, or an overflow fails the whole request with the part's position and code.
3. Write every part through the D1 path with `amount_estimated: true`, its servings range from the gram range, and a `portion_note` that labels the grams as the original estimate (for example "Estimated 300 g (250 to 350 g)") followed by the meal note. Then write the receipt and its membership. No pantry stock is consumed (D1).

The response lists the entries, the meal's totals computed like the ledger (a total is incomplete when any part lacks that nutrient), and the summed kcal range, which is null when any part has no bounds. Non-finite totals are refused before commit.

Per-part errors carry a stable code and the part's position. The MCP `issues` passthrough in `packages/engine/src/mcp/server.ts:108-111` is widened for this operation's codes only, including schema failures, which the SDK reports before the handler runs. The operation joins the guarded paths in `packages/engine/src/pantry/egress.ts` and the agent operation inventory, and is tested over HTTP and MCP.

### D4. Photo estimate route
`POST /api/photo/estimate` takes one JPEG, PNG or WebP image up to 5 MiB as the raw body. It is mounted outside the operation registry like the inbound email route (`packages/engine/src/inbound/endpoint.ts`), because operations parse JSON only. The image is held in memory for one call to the configured vision model and is never written to disk, the database or a log. The model returns proposed parts as structured output (name, a search query for candidates, grams, grams low and high, and a confidence note), which the route validates with a zod schema and returns without logging anything. The provider, model and key come from configuration; with no key, the route answers 503 `vision_unavailable` and the Photo tab is hidden. Which provider and model to use is decided by task 2.1 before this route is built.

### D5. Photo tab
A fourth tab next to Scan on the add-food screen. It captures one frame from the rear camera, or takes a picked file, and posts it to the D4 route. It shows the proposed parts with editable names and grams, a candidate picker per part (D2), and a Log button that calls `log_meal_parts`. It is online-only, since the outbox replays only intake and weight writes. The photo is dropped from memory after the estimate returns.

## Risks / Trade-offs

- [Wrong food picked: cooked vs raw, or a composite dish with no good USDA match] → the agent or the person picks from named candidates, the entry names the food it used, and the range covers the amount only. A composite with no match can still be logged ad hoc as today.
- [A writer change on the path every logging caller uses] → D1 is gated: it changes behaviour only when a referenced entry sets `amount_estimated`, and the existing logging tests stay green unchanged.
- [Vision cost and privacy] → photos are opt-in, never stored, and go only to the provider the operator configures with their own key.
- [The production USDA source needs an API key] → an OPS task sets it on the reference install before the agent path is used.

## Migration Plan

Two additive migrations: the estimated-amount columns on `intake_entries` (D1) and the meal receipt tables (D3). Existing rows are untouched. Deploy the engine changes; the agent path works once the USDA key is set. Rollback is a redeploy of the previous image after restoring the pre-deploy backup, because the old code does not know the new columns' rules.

## Open Questions

- Which vision provider and model (task 2.1).
