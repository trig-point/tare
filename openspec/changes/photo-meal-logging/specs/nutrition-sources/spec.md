## ADDED Requirements

### Requirement: Candidate search and pick by id
An agent or person SHALL be able to search USDA FoodData Central for candidate foods by name and receive up to 10 hits with a mass basis, Foundation and SR Legacy before Branded, each with its FDC id, name, data type, brand and kcal per 100 g. The search SHALL write nothing. Adding a chosen hit by its FDC id SHALL store that one record in the shared source cache through the USDA adapter and return its source food id; adding the same id again SHALL return the same row. This is an explicit lookup: the exact-match rule for automatic lookups SHALL NOT change, and no hit SHALL be stored unless it was chosen by id.

#### Scenario: Generic name
- **WHEN** an agent searches for "white rice cooked"
- **THEN** it receives named candidates with their FDC ids and kcal per 100 g, and the source cache is unchanged

#### Scenario: Pick by id
- **WHEN** the agent adds one candidate by its FDC id twice
- **THEN** one source food row exists and both calls return its id

#### Scenario: USDA not configured
- **WHEN** the install has no USDA key
- **THEN** the search answers `lookup_unavailable` rather than an empty list
