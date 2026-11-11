## ADDED Requirements

### Requirement: Optional private Grocy connection
Tare SHALL support one configured pantry owner, named by username, and an optional private Grocy connection. The deployment guide SHALL provide persistent container storage, HTTPS barcode intake whose proxy admits only the pantry owner, and a tested backup/restore procedure. Credentials SHALL remain server-side. Partial or malformed configuration, or an unknown owner username, SHALL prevent startup. Without configuration, logging SHALL work and pantry operations SHALL report disabled.

#### Scenario: Another user requests the pantry
- **WHEN** a user other than the configured owner requests pantry data or a stock action
- **THEN** access is rejected without returning products or sending a Grocy request

#### Scenario: Pantry is not configured
- **WHEN** no Grocy settings are present and the owner logs a food
- **THEN** the intake is saved and pantry operations report disabled

#### Scenario: Connection URL changes
- **WHEN** the engine starts with a Grocy URL different from the stored connection
- **THEN** pantry operations report reset required and no request is sent to the new server until the owner resets the connection

#### Scenario: Connection reset
- **WHEN** the owner resets the pantry connection
- **THEN** cached stock and bindings are cleared and a new connection generation starts, unless an old-generation request is unresolved, in which case the reset is refused

### Requirement: Complete stock snapshot
Tare SHALL expose current stock per product, original units, the earliest best-before date Grocy reports, refresh time and refresh errors through HTTP and MCP. Refresh SHALL atomically replace a validated complete snapshot, and SHALL discard a result fetched under an earlier connection generation. A snapshot older than ten minutes SHALL be marked stale. Missing grams conversions SHALL remain unknown. Pending and uncertain consumption SHALL be shown beside the product, not as confirmed Grocy stock.

#### Scenario: Empty stock after a successful refresh
- **WHEN** Grocy returns a valid empty stock response
- **THEN** previous stock rows are removed and the successful refresh time advances

#### Scenario: Failed or malformed refresh
- **WHEN** Grocy is unavailable or returns malformed data
- **THEN** previous stock remains visible with its original timestamp and the refresh error

#### Scenario: Snapshot is stale
- **WHEN** the last successful refresh is more than ten minutes old
- **THEN** pantry reads mark the stock stale

### Requirement: Explicit consumption matching
Tare SHALL consume only a confirmed binding from the exact food or source-food reference logged to exactly one Grocy product, with its stock unit and a positive quantity in that unit per serving. The owner or an agent acting for the owner SHALL create, confirm and delete bindings through owner-only operations; a barcode MAY propose a binding but SHALL NOT confirm it. Name similarity SHALL NOT create a binding. Stock consumption SHALL scale by logged servings. Unmatched, ambiguous, missing-product, unit-mismatch and unknown-quantity cases SHALL preserve nutrition logging and report why stock was not updated. Whether enough stock exists SHALL be decided by Grocy's consume response, not by the snapshot.

#### Scenario: Three-quarter grocery food
- **WHEN** a bound food's planned item is confirmed with the three-quarter action
- **THEN** its intake and requested stock amount use three quarters of the planned servings

#### Scenario: Ad hoc food has no match
- **WHEN** a food without a reference is logged
- **THEN** nutrition is saved and stock is unchanged with an explicit unmatched reason

#### Scenario: Conflicting binding
- **WHEN** a binding is saved for a reference that already has a different binding
- **THEN** the save is rejected and the existing binding is unchanged

#### Scenario: Snapshot shows too little stock
- **WHEN** a bound food is logged while the snapshot shows less than the requested amount
- **THEN** the intake and its request are saved with a shortage warning, and Grocy's response decides the outcome

### Requirement: Durable consumption delivery
Every referenced intake that is not explicitly suppressed SHALL create its consumption request in the same SQLite transaction as the intake. A request SHALL have its own never-reused id, belong to one connection generation and freeze its product, unit and quantity. At most one request SHALL link to an existing intake per generation. Delivery SHALL occur outside that transaction and only to the request's own generation. Replays SHALL reuse the request. Dispatch claims SHALL be durable and exclusive. A 2xx response with a decodable body SHALL be confirmed and record Grocy's returned transaction identifiers. A 4xx response with a decodable Grocy error SHALL be rejected with its reason. A timeout, lost response, 5xx response, undecodable body or restart after claim SHALL be uncertain and SHALL NOT be resent automatically.

#### Scenario: Replayed log or meal action
- **WHEN** the same client id or mutation id is submitted again
- **THEN** the original intake and stock request are returned without an additional consume call

#### Scenario: Consume response is lost
- **WHEN** Grocy might have accepted a consume but Tare cannot confirm the result
- **THEN** intake remains saved, the stock effect is shown as uncertain, and only an explicit reconciliation can authorize another attempt

#### Scenario: Grocy refuses the consume
- **WHEN** Grocy rejects a consume because the product has too little stock
- **THEN** the request is marked rejected with Grocy's reason and nothing is resent until the owner decides

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
The owner SHALL be able to inspect unresolved stock requests and, for an uncertain or rejected request, record exactly one of delivered, not delivered with one new attempt, or abandoned. A not-delivered decision on an uncertain attempt SHALL be refused while a dispatcher holds its claim or before its send time is older than the client deadline plus the deployment's pinned Grocy PHP execution limit. Each decision SHALL carry a mutation id and the attempt number it answers; a repeated mutation id SHALL return the first result and a decision for an older attempt SHALL be rejected as stale. A refresh SHALL NOT decide delivery from a stock delta. Before a request is claimed, a servings edit SHALL update its frozen quantity and intake deletion SHALL cancel it. Eaten-at and note edits SHALL have no stock effect. A claimed or resolved request SHALL outlive its intake without automatic compensation; a delivered request SHALL stay resolved.

#### Scenario: Delete after delivery
- **WHEN** an intake entry whose stock effect was delivered is deleted
- **THEN** nutrition history changes, the stock request remains inspectable as delivered and Grocy stock is not automatically restored

#### Scenario: Servings edited before sending
- **WHEN** the servings of an intake are edited before its request is claimed
- **THEN** the request's frozen quantity changes in the same transaction and one consume is later sent for the new amount

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
