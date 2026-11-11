## Context

`log_food` already writes through `insertIntake` in `packages/engine/src/logging/intake.ts`. `eat_meal` and `planned_item_action` share `applyMealAction` in `packages/engine/src/orders/eat.ts`, which inserts intake and decrements delivered meals in one SQLite transaction. These are the integration points; a second logging service would duplicate their replay rules.

V1 serves one person. Every new personal row retains `user_id`, and the shared two-user helper tests isolation. SQL stays in query files with generated TypeSQL types. Added test lines stay at most half of added source; mutation testing is disabled.

Reuse check: npm offers Grocy MCP servers, Node-RED nodes and a Digital Alchemy integration. None fits an in-process Hono operation using Tare's existing authentication and SQLite transaction. Use Node fetch and the already-installed Zod for the fixed API calls rather than introduce a second server or automation framework.

## Goals / Non-Goals

Goals: accurate grocery stock visible to agents, confirmed eating reflected in stock, and pantry-based suggestions immediately afterward in this same change.

Non-goals: a Tare grocery scanner, automatic product creation, copying order meals into Grocy, shopping-list writes, a numerical meal solver, or automatic consumption when merely planning or suggesting food.

## Decisions

### Run a separate Grocy container

Use the maintained LinuxServer Grocy image, linked from Grocy's own README, pinned by digest during implementation. Extend the existing Compose deployment with an opt-in Grocy service, a separate persistent volume and backup/restore instructions. The reference install already runs Tare in Docker and has Compose available. Keep personal host details and installation receipts outside this public repository.

The HA add-on is supported, but its configuration uses ingress and leaves the direct web port unbound by default. An API consumer outside HA would need an explicitly exposed endpoint. Keeping Grocy beside Tare uses the existing deployment tools and avoids a Supervisor dependency. This costs a separate backup responsibility; test restoring Grocy's volume separately from Tare's SQLite backup. Do not assume the old ticket's version or port is current.

Grocy's browser interface needs HTTPS for camera scanning. Route its UI through the install's authenticated HTTPS proxy; keep its REST endpoint private to the engine network. Never publish its API key to the PWA. Configure `TARE_GROCY_URL`, `TARE_GROCY_API_KEY` and `TARE_GROCY_USER_ID` together, or leave all unset. The user id selects the sole pantry owner, not a new account. Validate the configured user exists; only that user's operations can access the connection. Use the `GROCY-API-KEY` header, bounded requests, no redirects and redacted errors. Changing the connection requires explicit reset of its cached stock and bindings; never reuse old product ids against a different server.

### Reuse Grocy's stocking tools

Grocy already provides camera scanning, purchase/consume screens and an Open Food Facts barcode lookup plugin. Use its web UI first; Barcode Buddy and companion apps remain optional clients of the same API. Tare's existing scanner continues to resolve nutrition and log food. No scan in Tare implicitly means a grocery purchase.

### Keep a stock snapshot with honest units

Read `/api/stock`, product details, product barcodes and resolved unit conversions. `/stock` is aggregate current stock, not a per-lot ledger. Use product entries when expiry/lot details are needed. Refresh on startup and every five minutes through the existing job runner, with an explicit refresh operation. Fetch outside a database transaction, validate the whole response and replace the owner's snapshot in one transaction. A valid empty response clears previous stock; a failed or malformed response preserves it with the failure reason. No partial page set is a complete refresh.

Expose `list_pantry` and `refresh_pantry` through the operation registry, including last successful refresh, current error and whether stock is older than ten minutes. Preserve product id, stock quantity/unit and available expiry details. Grams are optional and require a product-specific resolved conversion; never equate one package, serving or milliliter with one gram. Snapshot rows, bindings and connection generation are user-scoped. Pending local consumption is displayed alongside the snapshot rather than presented as already confirmed Grocy stock.

### Matching is an explicit binding

A binding identifies exactly one owned Tare food or shared source-food reference, one Grocy product in the active connection, and a positive stock-unit amount per Tare serving. Verify the reference is accessible and the product/unit exists. An exact barcode can propose a binding only when it resolves to exactly one product; the person or agent confirms it and the quantity. A name match never consumes stock. Reject duplicate/conflicting bindings instead of choosing one.

For referenced intake, amount equals servings times the stored amount per serving, including the three-quarter action. Ad hoc logs with no reference have no match. Missing binding, deleted product, unknown conversion and insufficient stock are explicit stock-update reasons; nutrition logging still succeeds. Never consume a guessed amount or silently clamp it to stock on hand. A food representing a recipe needs explicit ingredient accounting in a later change before its ingredients can be auto-consumed; V1 recipe suggestions do not claim otherwise.

### Deliver consumption without blind retries

Add a durable request keyed by owner, intake id and connection generation. The core helper records the intake and its requested stock effect within the same existing `WriteScope`; no HTTP happens inside a SQLite transaction. The request freezes product and quantity so a later binding edit cannot change past consumption. Replaying a client id or mutation id returns the original intake and request, not a second request.

A single dispatcher claims a request transactionally before sending `POST /api/stock/products/{productId}/consume`. Persist that it might have been sent before the network call. A process crash after claim, timeout, lost response or undecodable success becomes uncertain and is never automatically resent. Grocy generates its transaction id server-side and has no client idempotency parameter. Stock deltas cannot prove delivery when another Grocy client also writes. A confirmed success saves the returned transaction/bookings identifiers and triggers refresh. A definite rejection exposes its reason and requires an explicit retry after correction. Do not infer that a server error guarantees no side effect.

Provide an owner-scoped reconciliation operation and minimal PWA controls. The person can confirm delivery after checking Grocy's journal, or explicitly confirm it was not delivered and authorize one new attempt. Keep each decision and attempt in the record. A clean refresh does not resolve an uncertain request. Rollback of the intake transaction creates no request; restart never drops unresolved requests. Resetting a connection is blocked while unresolved requests exist.

Edits and deletions change nutrition history, not physical consumption. Cancel an unsent request when its intake is deleted or its food/quantity changes. If delivery has started or completed, retain its record independently of intake deletion and surface reconciliation; do not automatically undo Grocy stock. Updating a note alone has no stock effect. This avoids treating a corrected calorie record as food returned to the cupboard.

The one-time historical importer suppresses stock effects explicitly. Merely reusing `insertIntake` must not turn importing old nutrition records into current pantry consumption.

### Preserve delivered-meal ownership

CookUnity and other delivered meals stay Tare-only, with existing order quantity/revision rules. The order-meal branch explicitly suppresses Grocy consumption even if the nutrition food has a grocery binding. A planned grocery food follows the binding rule; a planned order meal follows the order rule. Skip never logs or consumes. Directly logging a food by reference remains a grocery-food action; agents use `eat_meal` for delivered inventory. No duplicate Grocy product is created for an order meal.

### Suggestions follow pantry delivery in this change

First add a read-only Grocy recipe adapter using recipe fulfillment and `recipes_pos_resolved`. Preserve recipe-specific units and missing quantities; do not invent a cross-unit percent-cookable number. Grocy availability is separate from nutrition. Link a recipe to a known Tare food/serving explicitly before presenting numerical nutrition. Unknown nutrition remains unknown.

Then expose `pantry_suggestion_context` through HTTP/MCP, combining fresh grocery stock, delivered meals on hand, Grocy recipe fulfillment, known nutrition and `get_day_plan` slot budgets. Agents choose candidates from this context and call existing `plan_slot`; the user confirms with existing eating actions. The response identifies stale stock, pending/uncertain consumption and missing nutrition. Empty pantry or no feasible candidate is an explicit result, never invented ingredients. A suggestion makes no writes, reserves no stock and is rechecked before planning/eating. There is no claim of an optimal macro plan.

## Risks / Trade-offs

- An uncertain consume needs reconciliation. Accept this visible interruption rather than risk consuming twice; Grocy cannot atomically commit with Tare.
- A five-minute snapshot can miss another client's recent change. Show freshness and refresh before availability-sensitive actions; Grocy's consume response remains authoritative.
- Product-specific units need setup. Preserve the original unit and ask for a binding quantity rather than fabricate grams.
- Recipe suggestions do not yet deduct all ingredients. State that limitation in returned details and route grocery consumption through explicit food bindings only.
- A shared Grocy installation has no Tare tenant boundary. Bind it to one configured owner for V1; negative tests reject other users.
- Container storage is finite. The implementation checks space before image pulls and backs up both services; planning performs no deployment writes.

## Migration Plan

Land deployment instructions and client independently, then snapshot, bindings, delivery core and caller/UI integration. Land recipe reads and suggestion context second. New migrations are additive; regenerate TypeSQL output and exercise queries against a migrated SQLite database. With Grocy configuration absent, existing logging remains usable and pantry operations report disabled.

Before enabling consumption, perform a real disposable-Grocy smoke run covering stock read, fractional consume, replay and a dropped response. Record sanitized receipts. The reference deployment is a later authorized implementation action, not part of this planning change. Disable dispatch before rolling back the engine; retain the request history and Grocy volume. Never replay unresolved work automatically after restore.

## Open Questions

No scope decision blocks authoring. At installation, verify the pinned Grocy version and image digest, HTTPS camera access, backup restore and the reference host's free space. Record these as implementation evidence, without personal values in the repository.

## Sources

- Tare: `packages/engine/src/logging/intake.ts`, `packages/engine/src/orders/eat.ts`, `packages/engine/src/plan/items.ts`, `packages/engine/src/jobs.ts`, `docs/deploy.md` at base `7920fca`.
- [Grocy API schema](https://github.com/grocy/grocy/blob/41206cb90154e0d17d3e108cc1f182b94fdb465d/grocy.openapi.json): stock, barcode products, consume, transactions, resolved units and recipes.
- [Grocy stock implementation](https://github.com/grocy/grocy/blob/41206cb90154e0d17d3e108cc1f182b94fdb465d/services/StockService.php): consume and server-generated transaction id.
- [Grocy README](https://github.com/grocy/grocy/blob/41206cb90154e0d17d3e108cc1f182b94fdb465d/README.md): Docker image, HTTPS camera scanning and included Open Food Facts plugin.
- [HA add-on configuration](https://github.com/hassio-addons/app-grocy/blob/main/grocy/config.yaml): ingress and optional direct port. [LinuxServer image](https://github.com/linuxserver/docker-grocy).
