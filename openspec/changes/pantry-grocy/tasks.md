## 1. Pantry first

Each checkbox is one implementation PR. Estimates below count hand-written source and tests, excluding generated query output. All personal operations use the existing two-user helper. Comments explain why, stay under three lines on non-exported functions and carry no review history. No mutation testing.

- [ ] 1.1 Document an opt-in private Grocy container in the existing Compose deployment; builds on Docker Compose and linuxserver/grocy, with persistent storage, HTTPS intake, server-only credentials and backup/restore smoke evidence (complexity: judgment) (gate: none)

  Reuse MHA-100. Estimated 150 lines. Acceptance: a disposable install starts, its API answers from the engine network, its data survives recreation and a backup restores. Record the selected image digest; no personal host values in committed examples. Tests: Compose configuration validation and disposable real-service smoke; no new unit suite for documentation.

- [ ] 1.2 Integrate a typed Grocy HTTP client for stock, product/barcode, units and consume responses; builds on Node fetch and Zod, with bounded requests, redacted errors and no consume retries (complexity: judgment) (gate: none)

  Reuse MHA-103. Estimated 320 lines. Acceptance: validate configured URL/key/owner together; distinguish disabled, empty, malformed, unauthorized and transport failures; preserve returned transaction identifiers. Tests: controlled HTTP fixture for response validation and lost consume response; real disposable Grocy read/consume contract smoke. No third-party client needed for these fixed endpoints.

- [ ] 1.3 Persist and expose complete owner-scoped pantry snapshots with freshness and two-user test; builds on better-sqlite3, TypeSQL, the job runner and operation registry (depends on: 1.1, 1.2) (complexity: judgment) (gate: none)

  Reuse MHA-107. Estimated 450 lines. Acceptance: startup/five-minute/manual refresh; atomic replacement; empty clears, failure preserves; units stay native without a verified grams conversion; HTTP/MCP reads expose freshness and errors. Tests: complete/empty/malformed snapshots, reset and cross-user rejection against migrated SQLite. Include generated query output. Connection reset must not bypass unresolved consumption once task 1.5 lands.

- [ ] 1.4 Add explicit food-to-product bindings with quantity per serving and two-user test; builds on the existing food/source-food queries, TypeSQL and operation registry (depends on: 1.3) (complexity: judgment) (gate: none)

  New ticket. Estimated 300 lines. Acceptance: unique accessible reference and active Grocy product, positive stock-unit quantity, exact barcode suggestion requiring confirmation, no fuzzy matching; missing conversion/product is explicit. Tests: valid binding, conflicting/invalid quantity, deleted product, connection reset and cross-user reference rejection. No product-creation adapter.

- [ ] 1.5 Add the durable stock-consumption helper, dispatcher and reconciliation operations with a two-user test; builds on WriteScope, insertIntake, TypeSQL and the existing job runner (depends on: 1.2, 1.4) (complexity: judgment) (gate: none)

  New ticket. Estimated 600 lines. Acceptance: intake/request atomicity; frozen quantities; one request per owner/intake/connection; durable exclusive claim; success receipts; lost responses and claimed-request restarts require reconciliation; no blind resend; unsent edits cancel, started effects survive deletion; reset refuses unresolved work. Tests: rollback, replay, competing dispatch, dropped response/restart, explicit reconciliation and two-user rejection. A disposable Grocy smoke must cross the network once and demonstrate no duplicate consume after a lost response. Core API lands before caller wiring.

- [ ] 1.6 Connect logging and planned-food callers to stock consumption with visible outcomes and two-user test; builds on log_food, applyMealAction, the operation registry and TanStack Query (depends on: 1.3, 1.4, 1.5) (complexity: standard) (gate: none)

  New ticket. Estimated 450 lines. Acceptance: referenced grocery food consumes its bound serving quantity; unmatched logs still save; three-quarter portions scale; order meals always use Tare-only stock; skip/planning and historical import consume nothing; edit/delete call the core policy. Add a minimal pantry view for freshness, binding controls, unresolved requests and a Grocy intake link. Tests: HTTP/MCP and planned-food replay, order-food binding and historical-import exclusion, unmatched/shortage outcome and reconciliation display. Reuse core transactions; do not introduce a second write path.

## 2. Suggestions second

- [ ] 2.1 Read Grocy recipe availability and explicit nutrition links with a two-user test; builds on Grocy fulfillment, recipes_pos_resolved, the client and existing food references (depends on: 1.2, 1.3) (complexity: judgment) (gate: none)

  Reuse MHA-133. Estimated 350 lines. Acceptance: report missing amounts in original units, no invented percent-cookable metric; recipe nutrition only from a confirmed food/serving link; no recipe or stock writes. Tests: available/short/empty recipes, unknown nutrition, invalid response and cross-user link rejection. Run a read against disposable Grocy with a synthetic recipe.

- [ ] 2.2 Expose pantry suggestion context to agents with a two-user test; builds on the operation registry, get_day_plan, plan_slot, known nutrition, order stock and recipe availability (depends on: 1.3, 1.6, 2.1) (complexity: standard) (gate: none)

  New ticket. Estimated 400 lines. Acceptance: HTTP/MCP context combines grocery/meal candidates, slot budgets and availability caveats; empty/stale/uncertain and unknown nutrition remain explicit; agents can plan a known grocery food and the person can confirm it through the shared action. Recheck bound-food availability in plan_slot without reserving stock. Recipes disclose that ingredient deduction is not automatic. Tests: empty and stale stock, unresolved delivery, missing nutrition, other-user rejection and a context-to-plan-to-confirm journey. No solver, shopping push or new suggestion UI.

## 3. Dependencies and sizing

Work: 8 PRs. Span: 6 PRs. Average parallelism: 8/6 = 1.33. Critical paths start with either 1.1 or 1.2, then 1.3, 1.4, 1.5, 1.6, 2.2. Initial ready set: 1.1 and 1.2. Task 2.1 can run after 1.3 while the delivery path is built, but 2.2 follows completed pantry consumption.

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
