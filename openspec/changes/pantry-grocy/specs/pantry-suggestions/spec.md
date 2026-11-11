## ADDED Requirements

### Requirement: Recipe availability uses Grocy
Tare SHALL read Grocy recipe fulfillment and resolved ingredient quantities without writing recipes, stock or shopping lists. It SHALL preserve missing quantities and units, and SHALL NOT equate an ingredient-count percentage with nutritional or quantity fulfillment. Recipe nutrition SHALL require an explicit known Tare food/serving link that the owner creates through an owner-only operation. A link SHALL belong to one connection generation and SHALL be cleared when the connection is reset.

#### Scenario: Recipe has an ingredient shortage
- **WHEN** Grocy reports a recipe is not fully available
- **THEN** Tare reports the missing quantities in their own units and does not label it fully cookable

#### Scenario: Nutrition is unknown
- **WHEN** a recipe has no known nutrition link
- **THEN** availability can be reported but numerical calories and macros remain unknown

#### Scenario: New server reuses a recipe id
- **WHEN** the connection is reset to a different Grocy server that has a recipe with a previously linked id
- **THEN** that recipe has no nutrition link until the owner creates one

### Requirement: Read-only suggestion context
After pantry consumption is available, Tare SHALL expose pantry_suggestion_context through HTTP and MCP. It SHALL combine stock freshness, unresolved consumption, recipe availability, known food nutrition, delivered meals on hand and the day's slot budgets from read_day_plan. Missing, stale and empty data SHALL remain explicit. Availability SHALL subtract pending requests and sending requests sent after the snapshot's fetch started. A sending request sent before the fetch started, a delivered request confirmed after the fetch started, or an uncertain request SHALL mark the product uncertain without subtracting it; a delivered request stops doing so once a refresh started after its confirmation commits. It SHALL NOT invent ingredients or nutrition, reserve stock, or consume food.

#### Scenario: Pantry is empty
- **WHEN** the stock snapshot contains no products and there are no delivered meals on hand
- **THEN** context reports no on-hand candidates rather than fabricating a plan

#### Scenario: Consume confirmed after the snapshot was fetched
- **WHEN** the fetch starts, Grocy applies a consume, the snapshot reads stock, and the request is then confirmed
- **THEN** the product is marked uncertain and its amount is not subtracted until a refresh that started after the confirmation commits

#### Scenario: Stock is uncertain
- **WHEN** a product has pending, sending or uncertain consumption or the snapshot is stale
- **THEN** the context carries that limitation and does not present its quantity as confirmed current availability

### Requirement: Existing operations confirm suggestions
Agents SHALL use existing plan_slot and eating operations to propose and confirm food. Owned foods and delivered meals SHALL be planned with plan_slot; a candidate bound through a source food SHALL be offered for direct logging after the person confirms. For food items only, plan_slot SHALL recheck a bound food against the snapshot and return an availability caveat when stock is short, stale or uncertain, and SHALL NOT reject the plan on pantry stock. Recipe suggestions SHALL disclose that ingredient consumption is not automatic without explicit food bindings. Suggestions SHALL NOT claim an optimal macro plan.

#### Scenario: Suggested food is confirmed
- **WHEN** the person confirms a planned bound grocery food
- **THEN** the shared eating path logs intake and schedules its bound stock consumption once

#### Scenario: Planning a food the snapshot shows as short
- **WHEN** an agent plans a bound food whose snapshot stock is below the planned amount
- **THEN** the item is planned and the response carries a shortage caveat
