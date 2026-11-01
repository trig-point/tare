## ADDED Requirements

### Requirement: Per-person sensors through MQTT discovery
The engine SHALL publish one Home Assistant device per person through MQTT discovery, with identifiers built from an install id and the person's id, readable default entity ids, and sensors for target, remaining calories and protein, today's intake, weight trend and TDEE estimate. Discovery SHALL be re-published when Home Assistant announces it is online, and removed with an empty retained config when a person is deleted.

#### Scenario: Home Assistant restarts
- **WHEN** Home Assistant publishes its online status
- **THEN** the engine re-publishes discovery and current state

#### Scenario: Edited intake
- **WHEN** an intake entry is deleted and today's total drops
- **THEN** the sensor shows the lower value and no meter reset is recorded

### Requirement: Item buttons
Buttons for "ate it", "ate 3/4" and "skip" SHALL send the item id and a revision. The engine SHALL reject a press whose revision is stale and publish the result.

#### Scenario: Slot changed before the press
- **WHEN** a press arrives carrying the revision of an item that is no longer current
- **THEN** nothing is logged and the result sensor says the press was stale

### Requirement: Scale weigh-ins
The engine SHALL read weigh-ins published by the Home Assistant scale integration, map the scale's user to a Tare person from configuration, de-duplicate repeats, and turn unmapped or implausible readings into questions.

#### Scenario: Unmapped scale user
- **WHEN** a reading arrives for a scale user with no mapping
- **THEN** no weight is logged and a question is raised

### Requirement: Weekly notice
When targets are recomputed, the system SHALL notify the person in Home Assistant and in the app.

#### Scenario: New weekly target
- **WHEN** the weekly recompute stores a new target
- **THEN** a notice with the old and new target reaches Home Assistant and the app

### Requirement: Documented household trust
The documentation SHALL state that everyone who can use a shared Home Assistant can press any person's buttons, and SHALL include an example dashboard.

#### Scenario: Setup docs
- **WHEN** an operator reads the Home Assistant setup guide
- **THEN** it states the shared-dashboard trust model and shows an example dashboard
