## Context

A premise probe of main (a14d70f) found that logging by grams already works by arithmetic: USDA and Open Food Facts rows in the source cache are stored per 100 g, so `log_food` with a `source_food_id` and `servings = grams / 100` gives the right numbers (`packages/engine/src/logging/intake.ts:46-50`). Three things stand in the way of logging a photographed meal honestly:

1. An entry that references a food inherits the food's provenance, and asking for `estimated` fails with `provenance_mismatch` (`packages/engine/src/logging/provenance.ts:12-20`). A referenced entry also cannot carry `kcal_low` and `kcal_high` (`packages/engine/src/logging/schemas.ts:76-83`). So a USDA Foundation food in an estimated amount can only be logged as `verified` with no range, which overstates its certainty.
2. Lookups match names exactly (`packages/nutrition/src/identity.ts:35-40`), so a USDA search for "rice" returns `no_match` and caches nothing. That rule exists so a generic food is never silently substituted; raw and cooked white rice differ by nearly three times in kcal per 100 g.
3. Nothing accepts an image. Every operation parses JSON with body limits from 1 to 16 KiB, and `/mcp` caps at 64 KiB (`packages/engine/src/mcp/server.ts:144-148`).

The intake table already allows a referenced entry with provenance `estimated` and a range (`packages/engine/migrations/0002_core_schema.sql:53-81`), so the change lives in the writer, not the schema.

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
`log_food` with a `food_id` or `source_food_id` accepts `provenance: "estimated"` and an optional `servings_low` and `servings_high` (both or neither, `servings_low <= servings <= servings_high`). The snapshot is computed from the food exactly as today. When the request asks for `estimated`, the entry's provenance is `estimated` whatever the food's provenance, and `kcal_low` and `kcal_high` are the food's per-serving kcal times `servings_low` and `servings_high`. If the food has its own range, its low is multiplied by `servings_low` and its high by `servings_high`. Any other requested provenance that differs from the food's still fails with `provenance_mismatch`.

An entry is in this state when it references a food and its provenance is `estimated` while the food's is not. `edit_intake` with new `servings` on such an entry recomputes the snapshot and scales `kcal_low` and `kcal_high` by the ratio of new to old servings. `edit_intake` with `amount_measured: true` (with or without new servings) restores the food's provenance and clears the range. Bounds stay consistent with the database checks, so `kcal` always lies within them.

Alternative considered: ad hoc entries with server-computed numbers, the FDC id in `source` and grams in `portion_note`. It needs no writer change, but it drops the food reference, and `edit_intake` refuses `servings` on ad hoc entries, so a later weighing could not correct the amount. Rejected because correcting the amount is the point.

### D2. Candidate search and pick by id
Two agent operations sit beside `search_online` and use the existing USDA adapter:
- `search_food_candidates { query, limit }` (limit 1 to 10, default 10) returns USDA hits with a mass basis, Foundation and SR Legacy first and then Branded, each with its FDC id, name, data type, brand and kcal per 100 g. It writes nothing.
- `add_source_food { fdc_id }` fetches that one record with `fetchById`, stores it in the shared source cache like any adapter result, and returns its `source_food_id`. Repeating it returns the same row.

The exact-match rule for automatic lookups stays: these are explicit lookups, and the caller chooses. Open Food Facts is left out because its ids are barcodes, which is weak for generic foods.

### D3. `log_meal_parts`
Input: `client_id`, optional `eaten_at`, optional `meal_note` (up to 200 characters), and 1 to 12 parts. Each part has exactly one of `food_id` or `source_food_id`, `grams`, and an optional `grams_low` and `grams_high` (both or neither, low <= grams <= high). Grams become servings through `servingsFor` against the food's basis. A volume or count basis fails the whole request with `dimension_mismatch` and the part's index. Every part is written through the D1 path with provenance `estimated`. The `portion_note` holds the grams, the gram range and the meal note.

Part `n` (from 1) gets client id `<client_id>#<n>`. All parts are written in one `writeTransaction`, including pantry stock consumption, so either every part is logged or none is. Replaying the same `client_id` returns the stored entries and writes nothing. Every food is read before the transaction opens, because `writeTransaction` is synchronous. The response lists the entries plus the meal's kcal and macro totals and its summed kcal range. Per-part errors reach MCP callers through the `issues` passthrough in `packages/engine/src/mcp/server.ts:108-111`. The operation joins `stockOperations` and the guarded paths in `packages/engine/src/pantry/egress.ts`.

### D4. Photo estimate route
`POST /api/photo/estimate` takes one JPEG, PNG or WebP image up to 5 MiB as the raw body. It is mounted outside the operation registry like the inbound email route (`packages/engine/src/inbound/endpoint.ts`), because operations parse JSON only. The image is held in memory for one call to the configured vision model and is never written to disk, the database or a log. The model returns proposed parts as structured output (name, a search query for candidates, grams, grams low and high, and a confidence note), which the route validates with a zod schema and returns without logging anything. The provider, model and key come from configuration; with no key, the route answers 503 `vision_unavailable` and the Photo tab is hidden. Which provider and model to use is decided by task 2.1 before this route is built.

### D5. Photo tab
A fourth tab next to Scan on the add-food screen. It captures one frame from the rear camera, or takes a picked file, and posts it to the D4 route. It shows the proposed parts with editable names and grams, a candidate picker per part (D2), and a Log button that calls `log_meal_parts`. It is online-only, since the outbox replays only intake and weight writes. The photo is dropped from memory after the estimate returns.

## Risks / Trade-offs

- [Wrong food picked: cooked vs raw, or a composite dish with no good USDA match] → the agent or the person picks from named candidates, the entry names the food it used, and the range covers the amount only. A composite with no match can still be logged ad hoc as today.
- [A writer change on the path every logging caller uses] → D1 is gated: it changes behaviour only when a referenced entry asks for `estimated`, and the existing logging tests stay green unchanged.
- [Vision cost and privacy] → photos are opt-in, never stored, and go only to the provider the operator configures with their own key.
- [The production USDA source needs an API key] → an OPS task sets it on the reference install before the agent path is used.

## Migration Plan

No migration. Deploy the engine changes; the agent path works once the USDA key is set. Rollback is a redeploy of the previous image; entries written in the new state stay valid under the old code, which reads them as ordinary rows.

## Open Questions

- Which vision provider and model (task 2.1).
