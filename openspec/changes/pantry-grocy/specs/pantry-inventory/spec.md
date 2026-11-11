## ADDED Requirements

### Requirement: Optional private Grocy connection
Tare SHALL support one configured pantry owner and optional private Grocy connection. The deployment guide SHALL provide persistent container storage, HTTPS barcode intake and a tested backup/restore procedure. Credentials SHALL remain server-side. Partial or malformed configuration SHALL fail validation. Without configuration, logging SHALL work and pantry operations SHALL report disabled.

#### Scenario: Another user requests the pantry
- **WHEN** a user other than the configured owner requests pantry data or a stock action
- **THEN** access is rejected without returning products or sending a Grocy request

#### Scenario: Connection reset
- **WHEN** the configured Grocy connection changes
- **THEN** explicit reset clears prior cached ids and bindings, and unresolved consumption blocks the reset

### Requirement: Complete stock snapshot
Tare SHALL expose current stock, original units, available expiry details, refresh time and refresh errors through HTTP and MCP. Refresh SHALL atomically replace a validated complete snapshot. A snapshot older than ten minutes SHALL be marked stale. Missing grams conversions SHALL remain unknown.

#### Scenario: Empty stock after a successful refresh
- **WHEN** Grocy returns a valid empty stock response
- **THEN** previous stock rows are removed and the successful refresh time advances

#### Scenario: Failed or malformed refresh
- **WHEN** Grocy is unavailable or returns malformed data
- **THEN** previous stock remains visible with its original timestamp and the refresh error

### Requirement: Explicit consumption matching
Tare SHALL consume only a confirmed food-reference binding to exactly one Grocy product and a positive quantity in its stock unit per serving. Name similarity SHALL NOT create a binding. Stock consumption SHALL scale by logged servings. Unmatched, ambiguous, missing-product, unknown-quantity and insufficient-stock cases SHALL preserve nutrition logging and report why stock was not updated.

#### Scenario: Three-quarter grocery food
- **WHEN** a bound food's planned item is confirmed with the three-quarter action
- **THEN** its intake and requested stock amount use three quarters of the planned servings

#### Scenario: Ad hoc food has no match
- **WHEN** a food without a reference is logged
- **THEN** nutrition is saved and stock is unchanged with an explicit unmatched reason

### Requirement: Durable consumption delivery
An intake's consumption request SHALL be created in the same SQLite transaction as the intake, with a unique owner/intake/connection key and frozen product/quantity. Delivery SHALL occur outside that transaction. Replays SHALL reuse the request. Dispatch claims SHALL be durable and exclusive. A lost response or restart after claim SHALL require reconciliation rather than an automatic resend. Confirmed success SHALL record Grocy's returned transaction identifiers; a failed attempt SHALL expose its reason.

#### Scenario: Replayed log or meal action
- **WHEN** the same client id or mutation id is submitted again
- **THEN** the original intake and stock request are returned without an additional consume call

#### Scenario: Consume response is lost
- **WHEN** Grocy might have accepted a consume but Tare cannot confirm the result
- **THEN** intake remains saved, the stock effect is shown as uncertain, and only an explicit reconciliation can authorize another attempt

#### Scenario: Transaction rolls back
- **WHEN** the intake transaction fails
- **THEN** no stock request exists and no consume call is sent

### Requirement: Visible reconciliation and history correction
The owner SHALL be able to inspect unresolved stock requests and record delivered or explicitly not-delivered decisions. A refresh SHALL NOT decide delivery from a stock delta. Intake deletion or a food/quantity edit SHALL cancel an unsent request; already-started effects SHALL retain their history and require reconciliation without automatic compensation. A note edit SHALL have no stock effect.

#### Scenario: Delete after delivery
- **WHEN** an intake entry whose stock effect was delivered is deleted
- **THEN** nutrition history changes, the stock request remains inspectable and Grocy stock is not automatically restored

### Requirement: Delivered meals stay Tare-only
An order-meal action SHALL change existing Tare meal stock only, even when its nutrition reference has a Grocy binding. A planned grocery food SHALL use its binding. Planning and skip actions SHALL NOT consume any stock.

Historical import SHALL NOT consume current Grocy stock.

#### Scenario: Order meal shares a bound nutrition food
- **WHEN** the user confirms an order meal through eat_meal or planned_item_action
- **THEN** its Tare order quantity changes once and no Grocy consume is sent
