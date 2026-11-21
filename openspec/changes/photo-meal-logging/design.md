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
An additive migration adds `amount_estimated` (integer 0 or 1, NOT NULL, default 0), `servings_low` and `servings_high` (nullable REAL) to `intake_entries`. The CHECKs are written so that a NULL never satisfies them: `amount_estimated = 1` requires a food or source food reference, non-null `servings` and provenance `estimated`; the servings bounds are both null or both set; they are set only when `amount_estimated = 1`; and when set, `0 < servings_low <= servings <= servings_high`. Existing rows read as `amount_estimated = 0`. The generated queries and the intake row schema change together, and the new fields are optional when decoding a stored entry, because `eat_meal` and `planned_item_action` receipts replay saved entries through that schema (`packages/engine/src/orders/eat.ts:87-103, 211-226`); a legacy receipt replays with the flag 0 and no bounds, covered by a migration test.

`log_food` with a `food_id` or `source_food_id` accepts `amount_estimated: true` and an optional `servings_low` and `servings_high` (both or neither, `0 < low <= servings <= high`). A request that sets `amount_estimated` together with any `provenance` is refused with 400. The snapshot is computed from the food exactly as today. The entry's provenance is `estimated` whatever the food's provenance, and `kcal_low` and `kcal_high` are the food's per-serving kcal (or, when the food has its own range, its low and high) times `servings_low` and `servings_high`. Without a servings range, or when the food's kcal is unknown, the bounds are null, and adaptive TDEE applies its default range as it does for any estimated entry. Non-finite results, on a write or an edit, are refused before writing. Without `amount_estimated`, behaviour is unchanged, including `provenance_mismatch` for a differing requested provenance.

Edits on an estimated-amount entry always recompute from one source, the current food, as `edit_intake` already does for servings (`packages/engine/src/logging/operations.ts:139-150`):
- New `servings_low` and `servings_high`, with or without new `servings`: the bounds are validated against the new or stored servings (400 when they do not bracket it) and the snapshot and kcal bounds are recomputed from the current food.
- New `servings` alone: if the stored servings bounds still bracket the new amount, they are kept and the kcal bounds recomputed; if not, the servings bounds and kcal bounds are cleared. The entry stays an estimated amount.
- `amount_measured: true` (with or without new `servings`) recomputes the snapshot at the given or stored servings, restores the food's provenance and any range the food itself carries, sets `amount_estimated` to 0 and clears the servings bounds. Combining it with new servings bounds is refused with 400. On an entry that is not an estimated amount it is refused with 400.
- Stale bounds are never scaled.

An estimated-amount entry never consumes pantry stock: the pantry design says never consume a guessed amount (`openspec/changes/pantry-grocy/design.md:54-62`). The writer takes the existing suppress path for these entries, so no stock request and no pantry outcome row is written. A later `amount_measured` edit does not consume stock retroactively.

The existing HTTP test that expects `provenance_mismatch` for a verified USDA reference logged with `provenance: "estimated"` stays, because that request is still refused; the new path is the `amount_estimated` flag.

Alternatives considered: ad hoc entries with server-computed numbers (rejected: the food reference is lost and a later weighing cannot correct the amount, since `edit_intake` refuses `servings` on ad hoc entries), and inferring the state from "provenance differs from the food's" (rejected: an owned food can already be `estimated`, and `edit_food` can change a food's provenance later).

### D2. Candidate search and pick by id
Two agent operations sit beside `search_online` and use the existing USDA adapter:
- `search_food_candidates { query, limit }` (limit 1 to 10, default 10) returns USDA hits with a mass basis, Foundation and SR Legacy first and then Branded, each with its FDC id, name, data type, brand and kcal per 100 g. It writes nothing.
- `add_source_food { fdc_id }` fetches that one record with `fetchById`, stores it in the shared source cache like any adapter result, and returns its `source_food_id`. Repeating it returns the same row.

The exact-match rule for automatic lookups stays: these are explicit lookups, and the caller chooses. Open Food Facts is left out because its ids are barcodes, which is weak for generic foods.

### D3. `log_meal_parts`
Input: `client_id` (1 to 100 characters), optional `eaten_at`, optional `meal_note` (up to 200 characters; `portion_note` itself has no length limit today, `packages/engine/src/logging/schemas.ts:4,48`), and 1 to 12 parts. Each part has exactly one of `food_id` or `source_food_id`, `grams` (greater than 0), and an optional `grams_low` and `grams_high` (both or neither, `0 < grams_low <= grams <= grams_high`). The request body limit is 8192 bytes on HTTP.

A migration adds `meal_receipts`: id, person, client id, a random `part_key` (a UUID generated when the receipt is created), a hash of the request as sent (with `eaten_at` as given, before any default), part count and created time, unique per person and client id. There is no membership table: part `n` of a receipt always has the intake client id `meal-part:<part_key>:<n>`, and the shared intake writer (`insertIntake`) refuses the `meal-part:` prefix for every other new write, including `log_regular_meal` and meal actions, while existing rows and their retries are untouched. The random key means a part id cannot collide with any intake row written before the upgrade, so a part's client id identifies it uniquely and permanently.

Everything happens in one `writeTransaction`, with one `eaten_at` for the meal:
1. Look up the receipt by person and client id. Same hash: read the parts `meal-part:<part_key>:1..count`; if all exist, return them in order and write nothing; if any is missing (deleted), answer 409 `meal_part_deleted`. Different hash: 409 `mutation_conflict`.
2. Otherwise insert the receipt first with a new `part_key`.
3. Read each part's food once (an owned food scoped to the caller, or a shared source food) and use that same row for the conversion and the snapshot. Grams become servings with `servingsFor` against the food's basis.
4. Write every part through the D1 path with `amount_estimated: true`, its servings range from the gram range, and a `portion_note` that labels the grams as the original estimate (for example "Estimated 300 g (250 to 350 g)") followed by the meal note. Each insert must report `created: true`; anything else aborts the transaction with 409 `mutation_conflict`. No pantry stock is consumed (D1).

The response lists the entries, the meal's totals computed like the ledger (a total is incomplete when any part lacks that nutrient), and the summed kcal range, which is null when any part has no bounds. Every snapshot and every total is checked to be finite inside the transaction, before commit, and a failure is `amount_out_of_range`; the response is never validated only after the meal is written.

Errors: each part failure is one of a fixed set of codes with a numeric one-based `part` position in the error body (not inside the string-only `issues` list): `food_not_found` (missing, or another person's food), `no_serving_basis` (the stored basis is missing or incomplete), `dimension_mismatch` (a volume or count basis), `amount_out_of_range` (a conversion that overflows or yields servings of 0 or less), and `invalid_part` (a malformed part). On HTTP, schema failures map to these codes through the operation's `inputRejection`. On MCP, the tool's input schema accepts `parts` as an array of unconstrained items (the pinned SDK rejects a `null` item in an array-of-objects schema before the handler runs), and the operation validates each part itself, so a malformed part returns the same code and position as on HTTP instead of the SDK's generic text; the MCP `issues` passthrough (`packages/engine/src/mcp/server.ts:108-111`) is widened for this operation's codes only. The operation joins the guarded paths in `packages/engine/src/pantry/egress.ts` and the agent operation inventory, and is tested over HTTP and MCP.

### D4. Photo estimate route
`POST /api/photo/estimate` takes one JPEG, PNG or WebP image up to 5 MiB as the raw body. It is mounted outside the operation registry like the inbound email route (`packages/engine/src/inbound/endpoint.ts`), because operations parse JSON only. The image is held in memory for one call to the configured vision model and is never written to disk, the database or a log. The model returns proposed parts as structured output (name, a search query for candidates, grams, and grams low and high), which the route validates with a zod schema and returns without logging anything. An empty parts list answers 422 `vision_no_food`. The provider, model and key come from configuration; with no key, the route answers 503 `vision_unavailable` and the Photo tab is hidden. Which provider and model to use is decided by task 2.1 before this route is built.

### D5. Photo tab
A fourth tab next to Scan on the add-food screen. It captures one frame from the rear camera, or takes a picked file, and posts it to the D4 route. It shows the proposed parts with editable names and grams, a candidate picker per part (D2), and a Log button that calls `log_meal_parts`. It is online-only, since the outbox replays only intake and weight writes. The photo is dropped from memory after the estimate returns.

## Risks / Trade-offs

- [Wrong food picked: cooked vs raw, or a composite dish with no good USDA match] → the agent or the person picks from named candidates, the entry names the food it used, and the range covers the amount only. A composite with no match can still be logged ad hoc as today.
- [A writer change on the path every logging caller uses] → D1 is gated: it changes behaviour only when a referenced entry sets `amount_estimated`, and the existing logging tests stay green unchanged.
- [Vision cost and privacy] → photos are opt-in, never stored, and go only to the provider the operator configures with their own key.
- [The production USDA source needs an API key] → an OPS task sets it on the reference install before the agent path is used.

## Migration Plan

Two additive migrations: the estimated-amount columns on `intake_entries` (D1) and the meal receipt table (D3). Existing rows are untouched. Deploy the engine changes; the agent path works once the USDA key is set. Rollback is a redeploy of the previous image after restoring the pre-deploy backup, because the old code does not know the new columns' rules.

## Open Questions

- Which vision provider and model (task 2.1).
