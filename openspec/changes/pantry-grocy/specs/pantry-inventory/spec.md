## ADDED Requirements

### Requirement: Optional private Grocy connection
Tare SHALL support one configured pantry owner, named by username, and an optional private Grocy connection. The deployment guide SHALL provide persistent container storage, HTTPS barcode intake whose proxy admits only the pantry owner, and a tested backup/restore procedure. Credentials SHALL remain server-side. Partial or malformed configuration, or an unknown owner username, SHALL prevent startup. Without configuration, logging SHALL work and pantry operations SHALL report disabled.

#### Scenario: Another user requests the pantry
- **WHEN** a user other than the configured owner requests pantry data or a stock action
- **THEN** access is rejected without returning products or sending a Grocy request

#### Scenario: Pantry is not configured
- **WHEN** no Grocy settings are present and the owner logs a food
- **THEN** the intake is saved and pantry operations report disabled

#### Scenario: Partial configuration
- **WHEN** only some of the Grocy settings are present, or the owner username does not exist
- **THEN** the engine refuses to start and names the setting

#### Scenario: Connection URL changes
- **WHEN** the engine starts with a Grocy URL different from the stored connection
- **THEN** pantry operations report reset required, refresh and dispatch stop, and new intake saves nutrition with the reset-required reason and no request

#### Scenario: Pantry owner changes
- **WHEN** the engine starts with a different `TARE_GROCY_USERNAME` and the same URL
- **THEN** the pantry reports reset required and the new owner can reconcile and reset every existing request

#### Scenario: Grocy database replaced behind the same URL
- **WHEN** the owner resets the connection with the replaced flag while the URL is unchanged
- **THEN** refresh and dispatch stop at once and the reset completes only when no request is sending, uncertain or rejected

#### Scenario: Connection reset
- **WHEN** the owner resets the pantry connection
- **THEN** pending old-generation requests are cancelled, cached stock, bindings and recipe links are cleared and a new connection generation starts, unless an old-generation request is sending, uncertain or rejected, in which case the reset is refused

#### Scenario: Retry while reset is required
- **WHEN** the owner records a not-delivered decision on an old-generation request while reset is required
- **THEN** the decision is refused and delivered or abandoned remain available

### Requirement: Complete stock snapshot
Tare SHALL expose current stock per product, original units, the earliest best-before date Grocy reports, refresh time and refresh errors through HTTP and MCP. At most one refresh fetch SHALL be in flight per owner. Refresh SHALL atomically replace a validated complete snapshot, record its fetch start time, and discard a result fetched under an earlier connection generation. A snapshot older than ten minutes, or one that has never refreshed successfully, SHALL be marked stale; a never-refreshed pantry SHALL NOT be reported as empty. Missing grams conversions SHALL remain unknown. Pending, sending and uncertain consumption SHALL be shown beside the product, not as confirmed Grocy stock.

#### Scenario: Empty stock after a successful refresh
- **WHEN** Grocy returns a valid empty stock response
- **THEN** previous stock rows are removed and the successful refresh time advances

#### Scenario: Failed or malformed refresh
- **WHEN** Grocy is unavailable or returns malformed data
- **THEN** previous stock remains visible with its original timestamp and the refresh error

#### Scenario: Snapshot is stale
- **WHEN** the last successful refresh is more than ten minutes old
- **THEN** pantry reads mark the stock stale

#### Scenario: Overlapping refreshes
- **WHEN** a refresh is requested while another fetch is in flight
- **THEN** it waits for the running fetch, and an older fetch never replaces a newer snapshot

#### Scenario: Pantry has never refreshed
- **WHEN** no refresh has succeeded since the connection generation started
- **THEN** pantry reads report never refreshed and stale, not an empty pantry

### Requirement: Explicit consumption matching
Tare SHALL consume only a confirmed binding from the exact food or source-food reference logged to exactly one Grocy product, with its stock unit and a positive quantity in that unit per serving. The owner or an agent acting for the owner SHALL create, confirm and delete bindings through owner-only operations; a barcode MAY propose a binding but SHALL NOT confirm it. Name similarity SHALL NOT create a binding. Stock consumption SHALL scale by logged servings. Unmatched, ambiguous, missing-product, unit-mismatch and unknown-quantity cases SHALL preserve nutrition logging and report why stock was not updated. Saving the same product for an already bound reference SHALL replace its stored unit and quantity; saving a different product SHALL be rejected as a conflict. Whether enough stock exists SHALL be decided by Grocy's consume response, not by the snapshot.

#### Scenario: Three-quarter grocery food
- **WHEN** a bound food's planned item is confirmed with the three-quarter action
- **THEN** its intake and requested stock amount use three quarters of the planned servings

#### Scenario: Ad hoc food has no match
- **WHEN** a food without a reference is logged
- **THEN** nutrition is saved and stock is unchanged with an explicit unmatched reason

#### Scenario: Conflicting binding
- **WHEN** a binding to a different product is saved for a reference that is already bound
- **THEN** the save is rejected and the existing binding is unchanged

#### Scenario: Reconfirm after a unit change
- **WHEN** a binding reports a unit mismatch and the owner saves the same product with the current unit and a quantity
- **THEN** the stored unit and quantity are replaced and later intake consumes again

#### Scenario: Bound food without a usable binding
- **WHEN** the owner logs a referenced food with no binding, or while the pantry is disabled or reset is required
- **THEN** nutrition is saved, no request is created, and the reason is stored and returned with the intake

#### Scenario: Snapshot shows too little stock
- **WHEN** a bound food is logged while the snapshot shows less than the requested amount
- **THEN** the intake and its request are saved with a shortage warning, and Grocy's response decides the outcome

### Requirement: Durable consumption delivery
A non-suppressed intake by the configured owner whose reference has a binding with a valid recorded status in the active connection generation SHALL create its consumption request in the same SQLite transaction as the intake. Every non-suppressed referenced intake SHALL record, in that transaction, either its request or the reason no request was created, and that record SHALL be deleted with its intake. An ad hoc intake SHALL report an unmatched reason derived from its missing reference. A request SHALL have its own never-reused id, belong to one connection generation, keep its intake's client id and freeze its product, unit, per-serving amount and quantity. An intake whose owner and client id match a retained request SHALL NOT create another request. An engine starting on a restored backup SHALL convert pending and sending requests to uncertain before any dispatch. At most one request SHALL link to an existing intake per generation. Delivery SHALL occur outside that transaction and only to the request's own generation. Replays SHALL reuse the request and return its current state. Dispatch claims SHALL be durable and exclusive. A failure before any request bytes are written SHALL leave the request pending for the next sweep and SHALL NOT count as an attempt. A 2xx response with a schema-valid body SHALL be confirmed and record Grocy's returned transaction identifiers. A 4xx response with a schema-valid Grocy error SHALL be rejected with its reason. Every other result after request bytes may have been written, including a timeout, lost response, 3xx or 5xx response, schema-invalid body or restart after claim, SHALL be uncertain and SHALL NOT be resent automatically.

#### Scenario: Replayed log or meal action
- **WHEN** the same client id or mutation id is submitted again
- **THEN** the original intake and stock request are returned without an additional consume call

#### Scenario: Replay after the intake was deleted
- **WHEN** a client id is submitted again after its intake was deleted and its request retained
- **THEN** the new intake gets no consumption request and reports a replay-of-deleted-intake reason

#### Scenario: Backup restored with unresolved requests
- **WHEN** the engine starts on a restored Tare backup that contains pending or sending requests
- **THEN** those requests become uncertain and nothing is sent until the owner reconciles each one

#### Scenario: Consume response is lost
- **WHEN** Grocy might have accepted a consume but Tare cannot confirm the result
- **THEN** intake remains saved, the stock effect is shown as uncertain, and only an explicit reconciliation can authorize another attempt

#### Scenario: Grocy is unreachable before sending
- **WHEN** the connection to Grocy is refused before any request bytes are written
- **THEN** the request stays pending with the error and the next sweep tries again

#### Scenario: Grocy refuses the consume
- **WHEN** Grocy rejects a consume because the product has too little stock
- **THEN** the request is marked rejected with Grocy's reason and nothing is resent until the owner decides

#### Scenario: Bound product deleted before sending
- **WHEN** the pre-send product read returns 404
- **THEN** the request is rejected locally with a product-missing reason and no consume call is sent

#### Scenario: Bound product changes before sending
- **WHEN** a queued request's product has gained tare-weight handling or a different stock unit in Grocy
- **THEN** the request is rejected locally with that reason and no consume call is sent

#### Scenario: Transaction rolls back
- **WHEN** the intake transaction fails
- **THEN** no stock request exists and no consume call is sent

#### Scenario: Intake id is reused
- **WHEN** the newest intake is deleted after its request was claimed and a new intake receives the same id
- **THEN** the new intake gets its own new request and the earlier request keeps its own history

### Requirement: Visible reconciliation and history correction
The owner SHALL be able to inspect unresolved stock requests and resolved history from the last 30 days, and, for each uncertain or rejected attempt, record exactly one of delivered, not delivered with one new attempt, or abandoned. A pending request MAY be abandoned. A not-delivered decision on an uncertain attempt SHALL be refused while a dispatcher holds its claim, before its send time is older than the fixed 15-minute settling wait, or while reset is required. Each decision SHALL carry a mutation id and the attempt number it answers; a repeated mutation id SHALL return the first result and a decision for an older attempt SHALL be rejected as stale. A refresh SHALL NOT decide delivery from a stock delta. While a request is pending and has never had an attempt, a servings edit SHALL recompute its quantity from the frozen per-serving amount and intake deletion SHALL cancel it. Eaten-at and note edits SHALL have no stock effect. A request that has had an attempt or is resolved SHALL keep its frozen quantity, SHALL record a later servings edit as a notice while staying linked, and SHALL outlive its intake's deletion without automatic compensation; a delivered request SHALL stay resolved.

#### Scenario: Delete after delivery
- **WHEN** an intake entry whose stock effect was delivered is deleted
- **THEN** nutrition history changes, the stock request remains inspectable as delivered and Grocy stock is not automatically restored

#### Scenario: Servings edited before sending
- **WHEN** the servings of an intake are edited while its request is pending and has never had an attempt
- **THEN** the request's frozen quantity changes in the same transaction and one consume is later sent for the new amount

#### Scenario: Servings edited after sending
- **WHEN** the servings of an intake are edited after its request has had an attempt
- **THEN** nutrition changes, the request keeps its frozen quantity and link, and an edit notice is recorded

#### Scenario: Retry before the settling wait
- **WHEN** the owner records not delivered on an uncertain attempt sent less than 15 minutes ago
- **THEN** the decision is refused and the request stays uncertain

#### Scenario: Decision for an older attempt
- **WHEN** a decision names an attempt number older than the request's latest attempt
- **THEN** it is rejected as stale and nothing changes

#### Scenario: Abandon a rejected request
- **WHEN** the owner abandons a rejected request
- **THEN** the request is resolved, nutrition stays logged and no consume is sent

#### Scenario: Reconciliation response is lost
- **WHEN** the owner retries a not-delivered decision with the same mutation id after its new attempt already started
- **THEN** the first result is returned and no further attempt is authorized

### Requirement: Delivered meals stay Tare-only
An order-meal action SHALL change existing Tare meal stock only, even when its nutrition reference has a Grocy binding. A planned grocery food SHALL use its binding. Planning and skip actions SHALL NOT consume any stock. Historical import SHALL NOT consume current Grocy stock.

#### Scenario: Order meal shares a bound nutrition food
- **WHEN** the user confirms an order meal through eat_meal or planned_item_action
- **THEN** its Tare order quantity changes once and no Grocy consume is sent

#### Scenario: Skip a planned grocery food
- **WHEN** the user skips a planned bound grocery food
- **THEN** nothing is logged and no stock request is created

#### Scenario: Historical import
- **WHEN** old intake records are imported
- **THEN** no stock request is created
