## ADDED Requirements

### Requirement: Logging operations
The system SHALL provide operations to log food, log weight, read today's totals, find a food, and edit and delete entries. Writes SHALL be idempotent by client id.

#### Scenario: Log food from the catalog
- **WHEN** a person logs a catalog food with a number of servings
- **THEN** today's totals include its calories and macros with the food's provenance

#### Scenario: Repeated client id
- **WHEN** the same entry is submitted twice with the same client id
- **THEN** one entry exists

### Requirement: Per-person day boundary
Each person SHALL have a timezone and a day-start hour, defaulting to 4 AM, and entries SHALL be assigned to days by that rule.

#### Scenario: Late snack
- **WHEN** a person with the default day start logs a snack at 1 AM local time
- **THEN** it counts toward the previous day

### Requirement: Day sign-off
A person SHALL be able to close a day by reviewing its ledger and recording hunger, fullness and notes. Only a signed-in person, not an agent token, SHALL mark a day complete.

#### Scenario: Close a day
- **WHEN** a person reviews a day and signs it off
- **THEN** the day is marked complete with the time of sign-off

#### Scenario: Agent tries to sign off
- **WHEN** an agent token calls the sign-off operation
- **THEN** the call is rejected; agents may add notes but not complete the day

### Requirement: Food entry screens
The app SHALL show today's totals and remaining budget, let a person log weight, search the catalog, quick-add calories and protein, and edit or delete entries. Online lookups SHALL run only when the person asks.

#### Scenario: Search online
- **WHEN** a catalog search finds nothing and the person taps "search online"
- **THEN** one lookup runs against the external sources

### Requirement: Barcode scanning
The app SHALL scan EAN-13, UPC-A, EAN-8 and UPC-E barcodes with the browser's native detector when it supports them and with a self-hosted, precached WASM reader otherwise, and SHALL offer manual barcode entry.

#### Scenario: Native detector missing
- **WHEN** the browser has no barcode detector and the device is offline
- **THEN** scanning still works with the cached WASM reader

#### Scenario: Leading zero
- **WHEN** a UPC-A code with a leading zero is scanned
- **THEN** the code is kept as a string and normalized before lookup

### Requirement: Regular meals
A person SHALL be able to save named regular meals (such as a usual restaurant order) with calories, macros, an uncertainty range and a baseline source, and log them in one step.

#### Scenario: Log a regular meal
- **WHEN** a person logs a saved regular meal
- **THEN** the entry carries the meal's values, range and provenance `estimated`

### Requirement: One-time importer
A command SHALL import intake, weight and day-note JSON lines into a named person's account, idempotently. Imported days SHALL arrive not signed off.

#### Scenario: Import twice
- **WHEN** the same files are imported twice
- **THEN** no entry is duplicated
