## ADDED Requirements

### Requirement: Logging operations
The system SHALL provide operations to log food, log weight, edit and delete entries, read today's totals and find a food. Each intake entry SHALL carry the time it was eaten. Writes SHALL be idempotent by a client id that is unique per person.

#### Scenario: Log food from the catalog
- **WHEN** a person logs a catalog food with a number of servings
- **THEN** today's totals include its calories and macros with the food's provenance

#### Scenario: Repeated client id
- **WHEN** the same entry is submitted twice with the same client id
- **THEN** one entry exists and the second call returns it

### Requirement: Per-person day boundary
Each person SHALL have a timezone and a day-start hour, defaulting to 4 AM. Each intake entry's day SHALL be computed from its eaten-at time, and each weigh-in's day from its measured-at time, by that rule when it is written, and stored.

#### Scenario: Late snack
- **WHEN** a person with the default day start logs a snack eaten at 1 AM local time
- **THEN** it counts toward the previous day

#### Scenario: Timezone change
- **WHEN** a person changes their timezone
- **THEN** entries already written keep their stored day, and new entries use the new timezone

### Requirement: Day sign-off
A person SHALL be able to close a day by reviewing its ledger and recording hunger, fullness and notes. Only a person in the app (a browser identity), not an agent, SHALL mark a day complete. Any create, edit or delete of a signed-off day's intake, by any path, SHALL clear that day's sign-off until the person signs it off again; an edit that moves an entry to another day SHALL clear the sign-off of both days. Operations SHALL read one day's ledger and list the past days that are not signed off, and the app SHALL use them so the person can review those days in turn.

#### Scenario: Close a day
- **WHEN** a person reviews a day and signs it off
- **THEN** the day is marked complete with the time of sign-off

#### Scenario: Agent tries to sign off
- **WHEN** an agent service token calls the sign-off operation
- **THEN** the call is rejected with 403; agents may add notes but not complete the day

#### Scenario: Intake changed after sign-off
- **WHEN** an agent or the person edits, adds or deletes an intake entry on a signed-off day
- **THEN** the day is no longer signed off until the person signs it off again

#### Scenario: Entry moved to another day
- **WHEN** an entry on signed-off day A is edited so its eaten-at time falls on signed-off day B
- **THEN** neither day is signed off any more

#### Scenario: Note added after sign-off
- **WHEN** an agent adds a note to a signed-off day
- **THEN** the day stays signed off

### Requirement: Food entry screens
The app SHALL show today's totals and remaining budget, let a person log weight, search the catalog, quick-add calories and protein, and edit or delete entries. Online lookups SHALL run only when the person asks.

#### Scenario: Search online
- **WHEN** a catalog search finds nothing and the person taps "search online"
- **THEN** one lookup runs against the external sources and only exact matches are offered

### Requirement: Barcode scanning
The app SHALL scan EAN-13, UPC-A, EAN-8 and UPC-E barcodes with the browser's native detector when it supports them and with a self-hosted, precached WASM reader otherwise, and SHALL offer manual barcode entry. Both readers SHALL come from the barcode-detector package, with its zxing-wasm file served by the engine.

#### Scenario: Native detector missing
- **WHEN** the browser has no barcode detector and the device is offline
- **THEN** scanning still works with the cached WASM reader

#### Scenario: Leading zero
- **WHEN** a UPC-A code with a leading zero is scanned
- **THEN** the code is kept as a string and normalized before lookup

### Requirement: Regular meals
A person SHALL be able to save, edit and delete named regular meals (such as a usual restaurant order) with calories, macros, an uncertainty range and a baseline source (where the values came from: a published menu, a label, or the person's own estimate), and log them in one step. The baseline source SHALL set the meal's provenance under the rule that provenance is set by its source: a published menu or a label gives `label` with that source named, and the person's own estimate gives `estimated`. Regular meals SHALL be owned by the person who saved them and SHALL NOT be visible to anyone else.

#### Scenario: Log a regular meal
- **WHEN** a person logs a saved regular meal whose baseline source is their own estimate
- **THEN** the entry carries the meal's values, range and provenance `estimated`

#### Scenario: Meal from a published menu
- **WHEN** a person saves a regular meal whose values come from the restaurant's published menu and logs it
- **THEN** the entry carries provenance `label` with the menu named as its source

#### Scenario: Another person's meal
- **WHEN** another person searches for that meal's name or logs it by id
- **THEN** the search returns nothing and the log is rejected as not found

### Requirement: One-time importer
A command SHALL import intake, weight and day-note JSON lines into a named person's account, idempotently, through the engine's database module. Imported days SHALL arrive not signed off.

#### Scenario: Import twice
- **WHEN** the same files are imported twice
- **THEN** no entry is duplicated
