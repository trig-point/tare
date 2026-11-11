## ADDED Requirements

### Requirement: Recipe availability uses Grocy
Tare SHALL read Grocy recipe fulfillment and resolved ingredient quantities without writing recipes, stock or shopping lists. It SHALL preserve missing quantities and units, and SHALL NOT equate an ingredient-count percentage with nutritional or quantity fulfillment. Recipe nutrition SHALL require an explicit known Tare food/serving link.

#### Scenario: Recipe has an ingredient shortage
- **WHEN** Grocy reports a recipe is not fully available
- **THEN** Tare reports the missing quantities in their own units and does not label it fully cookable

#### Scenario: Nutrition is unknown
- **WHEN** a recipe has no known nutrition link
- **THEN** availability can be reported but numerical calories and macros remain unknown

### Requirement: Read-only suggestion context
After pantry consumption is available, Tare SHALL expose pantry_suggestion_context through HTTP and MCP. It SHALL combine stock freshness, unresolved consumption, recipe availability, known food nutrition, delivered meals on hand and the day's slot budgets. Missing, stale and empty data SHALL remain explicit. It SHALL NOT invent ingredients or nutrition, reserve stock, or consume food.

#### Scenario: Pantry is empty
- **WHEN** the stock snapshot contains no products and there are no delivered meals on hand
- **THEN** context reports no on-hand candidates rather than fabricating a plan

#### Scenario: Stock is uncertain
- **WHEN** a product has unresolved consumption or the snapshot is stale
- **THEN** the context carries that limitation and does not present its quantity as confirmed current availability

### Requirement: Existing operations confirm suggestions
Agents SHALL use existing plan_slot and eating operations to propose and confirm food. Planning SHALL recheck referenced availability. Recipe suggestions SHALL disclose that ingredient consumption is not automatic without explicit food bindings. Suggestions SHALL NOT claim an optimal macro plan.

#### Scenario: Suggested food is confirmed
- **WHEN** the person confirms a planned bound grocery food
- **THEN** the shared eating path logs intake and schedules its bound stock consumption once
