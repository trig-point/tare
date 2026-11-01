## ADDED Requirements

### Requirement: Exact-match source chain
Nutrition lookup SHALL try known foods, then USDA FoodData Central, then Open Food Facts, and SHALL accept only a match on identity and serving basis. A miss SHALL become a question, never a substituted generic food. Unknown values SHALL be stored as unknown, never as zero.

#### Scenario: Similar name only
- **WHEN** the only external hit is a generic food with a similar name
- **THEN** the system asks the person instead of logging the generic values

### Requirement: Provenance per source
Each adapter SHALL emit only its own provenance class: USDA Foundation and SR Legacy data as `verified`, Open Food Facts and typed labels as `label`.

#### Scenario: Open Food Facts product
- **WHEN** a barcode resolves through Open Food Facts
- **THEN** its values are stored with provenance `label`

### Requirement: Open Food Facts adapter
The adapter SHALL look up products by barcode, send the configured User-Agent, respect the documented rate limits, and cache results in the catalog.

#### Scenario: Repeat barcode
- **WHEN** a barcode already in the catalog is scanned again
- **THEN** no external request is made

### Requirement: USDA FoodData Central adapter
The adapter SHALL use an API key from configuration, search only on explicit request, and cache results in the catalog.

#### Scenario: No key configured
- **WHEN** no USDA key is configured
- **THEN** the USDA step is skipped and the chain continues
