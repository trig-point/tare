## 1. Pantry first

Each checkbox is one implementation PR. Estimates below count hand-written source and tests, excluding generated query output. All personal operations use the existing two-user helper. Comments explain why, stay under three lines on non-exported functions and carry no review history. No mutation testing.

- [ ] 1.1 Document an opt-in private Grocy container in the existing Compose deployment; builds on Docker Compose and linuxserver/grocy, with persistent storage, HTTPS intake, server-only credentials and backup/restore smoke evidence (complexity: judgment) (gate: none)

  Reuse MHA-100. Estimated 150 lines. Acceptance: a disposable install starts, its API answers from the engine network, its data survives recreation and a backup restores. Record the selected image digest; no personal host values in committed examples. Tests: Compose configuration validation and disposable real-service smoke; no new unit suite for documentation.

- [ ] 1.2 Integrate a typed Grocy HTTP client for stock, product/barcode, units and consume responses; builds on Node fetch and Zod, with bounded requests, redacted errors and no consume retries (complexity: judgment) (gate: none)

  Reuse MHA-103. Estimated 320 lines. Acceptance: add `TARE_GROCY_URL`, `TARE_GROCY_API_KEY` and `TARE_GROCY_USERNAME` to config loading, `.env.example` and the configuration section of `AGENTS.md`; a partial set or unknown owner username prevents startup; distinguish disabled, empty, malformed, unauthorized and transport failures; classify consume outcomes as confirmed (2xx, decodable), rejected (4xx with a decodable Grocy error) or uncertain (timeout, lost response, 5xx, undecodable); preserve returned transaction identifiers. Tests: controlled HTTP fixture for response validation, outcome classification and lost consume response; real disposable Grocy read/consume contract smoke. No third-party client needed for these fixed endpoints.

- [ ] 1.3 Persist and expose complete owner-scoped pantry snapshots with freshness and two-user test; builds on better-sqlite3, TypeSQL, the job runner and operation registry (depends on: 1.1, 1.2) (complexity: judgment) (gate: none)

  Reuse MHA-107. Estimated 450 lines. Acceptance: five-minute cron refresh, one explicit refresh after the job runner starts (it has no run-on-start option) and manual refresh; one row per product with the earliest best-before date; connection generation stored with the normalized URL, `reset_required` when the configured URL changes, and the owner-only `reset_pantry_connection` operation; atomic replacement; empty clears, failure preserves; units stay native without a verified grams conversion; HTTP/MCP reads expose freshness and errors. Tests: complete/empty/malformed snapshots, URL change, reset and cross-user rejection against migrated SQLite. Include generated query output. Task 1.5 adds the guard that refuses reset while requests are unresolved.

- [ ] 1.4 Add explicit food-to-product bindings with quantity per serving and two-user test; builds on the existing food/source-food queries, TypeSQL and operation registry (depends on: 1.3) (complexity: judgment) (gate: none)

  New ticket. Estimated 300 lines. Acceptance: `propose_pantry_binding`, `save_pantry_binding` and `delete_pantry_binding` for the owner; unique accessible food or source-food reference and active Grocy product; stock unit id stored with the binding and a later unit change reported as a mismatch; tare-weight products rejected; positive stock-unit quantity; source-food barcode proposal requiring confirmation; no fuzzy matching or inheritance between a food and its source food; missing conversion/product is explicit. Tests: valid binding, conflicting/invalid quantity, unit mismatch, deleted product, connection reset and cross-user reference rejection. No product-creation adapter.

- [ ] 1.5 Add the durable stock-consumption helper, dispatcher and reconciliation operations with a two-user test; builds on WriteScope, insertIntake, TypeSQL and the existing job runner (depends on: 1.2, 1.3, 1.4) (complexity: judgment) (gate: none)

  New ticket. Estimated 650 lines. Acceptance: explicit stock-effect argument on `insertIntake` (`suppress` or create); intake/request atomicity; requests with their own never-reused id, at most one per existing intake and generation; frozen product, unit and quantity; dispatch only to the request's own generation, right after commit and on a one-minute sweep; durable exclusive claim; success receipts trigger a refresh; lost responses and claimed-request restarts become uncertain; no blind resend; delivered, not-delivered-and-retry and abandoned decisions with a mutation id and attempt number; a servings edit before claim updates the frozen quantity, deletion before claim cancels, claimed or resolved requests outlive their intake; reset refuses unresolved work. Tests: rollback, replay, reused intake id, competing dispatch, dropped response/restart, stale and repeated reconciliation decisions, abandon, edit before claim and two-user rejection. A disposable Grocy smoke must cross the network once and demonstrate no duplicate consume after a lost response. Core API lands before caller wiring.

- [ ] 1.6 Connect intake callers to stock consumption with visible outcomes and two-user test; builds on log_food, log_regular_meal, edit_intake, delete_intake, applyMealAction, the importer and the operation registry (depends on: 1.3, 1.4, 1.5) (complexity: judgment) (gate: none)

  New ticket. Estimated 300 lines. Acceptance: referenced grocery food, including a regular meal logged with `log_regular_meal`, consumes its bound serving quantity; unmatched logs still save; three-quarter portions scale; order meals and historical import pass `suppress`; skip and planning consume nothing; edit/delete call the core policy; stock outcomes on replayed receipts are optional fields so stored receipts still parse. Tests: HTTP/MCP and planned-food replay, regular meal, order-food binding and historical-import exclusion, unmatched/shortage outcome. Reuse core transactions; do not introduce a second write path.

- [ ] 1.7 Add a minimal pantry view with freshness, binding controls, unresolved requests, reconciliation decisions and a Grocy intake link; builds on TanStack Query and the pantry, binding and reconciliation operations (depends on: 1.3, 1.4, 1.5) (complexity: standard) (gate: none)

  New ticket. Estimated 250 lines. Acceptance: shows stale and failed refresh, disabled and reset-required states; creates and deletes bindings; records delivered, not-delivered-and-retry and abandoned decisions. Tests: one rendering test per state and a reconciliation decision round trip. No new barcode intake screen.

## 2. Suggestions second

- [ ] 2.1 Read Grocy recipe availability and explicit nutrition links with a two-user test; builds on Grocy fulfillment, recipes_pos_resolved (Grocy's resolved ingredient view), the client and existing food references (depends on: 1.2, 1.3) (complexity: judgment) (gate: none)

  Reuse MHA-133. Estimated 350 lines. Acceptance: report missing amounts in original units, no invented percent-cookable metric; recipe nutrition only from a food/serving link the owner creates with `save_recipe_nutrition_link`; no recipe or stock writes. Tests: available/short/empty recipes, unknown nutrition, invalid response and cross-user link rejection. Run a read against disposable Grocy with a synthetic recipe.

- [ ] 2.2 Expose pantry suggestion context to agents with a two-user test; builds on the operation registry, read_day_plan, plan_slot, known nutrition, order stock and recipe availability (depends on: 1.3, 1.6, 2.1) (complexity: standard) (gate: none)

  New ticket. Estimated 400 lines. Acceptance: HTTP/MCP context combines grocery/meal candidates, slot budgets and availability caveats; empty/stale/uncertain and unknown nutrition remain explicit; agents can plan an owned grocery food and the person can confirm it through the shared action; a candidate bound through a source food is offered for direct logging. plan_slot rechecks a bound food against the snapshot and returns a caveat when it is short, stale or uncertain, never rejecting and never reserving stock. Recipes disclose that ingredient deduction is not automatic. Tests: empty and stale stock, unresolved delivery, missing nutrition, plan_slot shortage caveat, other-user rejection and a context-to-plan-to-confirm journey. No solver, shopping push or new suggestion UI.

## 3. Dependencies and sizing

Work: 9 PRs. Span: 6 PRs. Average parallelism: 9/6 = 1.5. Critical paths start with either 1.1 or 1.2, then 1.3, 1.4, 1.5, 1.6, 2.2. Initial ready set: 1.1 and 1.2. Task 2.1 can run after 1.3 while the delivery path is built, and 1.7 runs beside 1.6; 2.2 follows completed pantry consumption.

Start with two lanes for 1.1 and 1.2. Serialize later edits to engine configuration, registry and migrations; allocate migration numbers at dispatch. Gate span: zero mutation runs under the Tare ruling; build span controls sequencing. Every judgment task requires the approach review before implementation dispatch. All estimates are below 800 hand-written lines; split before implementation if that changes.

## 4. Existing-ticket reconciliation

- MHA-100: rewrite and move to V1 Meal plan as task 1.1; container deployment replaces the assumed HA add-on/version/port.
- MHA-103: rewrite and move to V1 Meal plan as task 1.2; fixed-endpoint client, no product creation or recipe writes.
- MHA-105: cancel; Grocy already includes Open Food Facts external barcode lookup. No duplicate Tare product-creation pipeline.
- MHA-106: cancel; Grocy already has stocking screens and camera scanning. Tare's scanner remains the existing nutrition-log path.
- MHA-107: rewrite and move to V1 Meal plan as task 1.3; preserve stock units rather than requiring fabricated canonical grams.
- MHA-133: rewrite and move to V1 Meal plan as task 2.1; fulfillment and explicit nutrition links replace an unspecified percentage.
- MHA-138: retain in Post-V1, outside this change; shopping-list writes are not required to read pantry stock or suggest meals.
- MHA-104: retain as completed; no pantry intake dependency or scanner rewrite.
