## ADDED Requirements

### Requirement: Exact-match source chain
Nutrition lookup SHALL accept only a match on identity and serving basis and SHALL never substitute a similar-named generic food. An automatic lookup (a food named in a log call or a meal from an order) SHALL search only the person's own foods and the shared source cache. External sources SHALL be searched only on an explicit lookup (a barcode scan or "search online"), USDA FoodData Central before Open Food Facts. A miss in an explicit lookup SHALL be reported as no match with manual entry offered; a miss for an order's meal SHALL become a question. Unknown values SHALL be stored as unknown, never as zero.

#### Scenario: Similar name only
- **WHEN** the only external hit for an explicit lookup is a generic food with a similar name
- **THEN** the lookup reports no exact match and nothing is logged

#### Scenario: Unknown fiber
- **WHEN** a product has calories and protein but no fiber value
- **THEN** fiber is stored as unknown and totals show it as incomplete rather than zero

### Requirement: Provenance per source
Each adapter SHALL emit only the provenance class of the data it read: USDA Foundation and SR Legacy foods as `verified`, USDA Branded foods and Open Food Facts products as `label`. The USDA adapter SHALL request only the Foundation, SR Legacy and Branded data types.

#### Scenario: Open Food Facts product
- **WHEN** a barcode resolves through Open Food Facts
- **THEN** its values are stored with provenance `label`

#### Scenario: USDA branded food
- **WHEN** a USDA search returns a Branded food
- **THEN** its values are stored with provenance `label`, not `verified`

### Requirement: Shared source cache
Results from the external adapters SHALL be written to a source cache shared by every person on the install, and only the adapters SHALL write to it.

#### Scenario: Repeat barcode
- **WHEN** a barcode already in the source cache is scanned again, by the same person or another
- **THEN** no external request is made

### Requirement: Open Food Facts adapter
The adapter SHALL look up products by barcode, send the configured User-Agent, and stay within 100 product reads and 10 searches a minute.

#### Scenario: Rate limit reached
- **WHEN** a lookup would exceed the per-minute limit
- **THEN** the adapter returns a rate-limited result without calling Open Food Facts

### Requirement: USDA FoodData Central adapter
The adapter SHALL use an API key from configuration and search only on an explicit request.

#### Scenario: No key configured
- **WHEN** no USDA key is configured
- **THEN** the USDA step is skipped and the explicit lookup continues with Open Food Facts
