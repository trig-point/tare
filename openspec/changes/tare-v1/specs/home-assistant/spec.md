## ADDED Requirements

### Requirement: Per-person sensors through MQTT discovery
The engine SHALL publish one Home Assistant device per person through MQTT discovery, with identifiers built from an install id and the person's id, readable default entity ids, and sensors for target, remaining calories and protein, today's intake and weight trend. The TDEE estimate sensor SHALL arrive with the weekly recompute. Discovery SHALL be re-published when Home Assistant publishes its online status (its birth message). An entity that goes away SHALL be removed with an empty retained config on its own discovery topic. kcal sensors SHALL carry no meter-style state class.

#### Scenario: Home Assistant restarts
- **WHEN** Home Assistant publishes its online status
- **THEN** the engine re-publishes discovery and current state

#### Scenario: Edited intake
- **WHEN** an intake entry is deleted and today's total drops
- **THEN** the sensor shows the lower value and no meter reset is recorded

### Requirement: Item buttons
Each on-hand meal SHALL get "ate it" and "ate 3/4" buttons, and each planned item that is not yet eaten or skipped SHALL get "ate it", "ate 3/4" and "skip" buttons. Each button's discovery config SHALL carry the item id and its current revision in the press payload, and SHALL be re-published whenever the item or its revision changes; a planned item's buttons are removed once it is eaten or skipped. A press SHALL run the shared meal action; the engine SHALL reject a press whose revision is stale and publish the outcome to a last-press result sensor for that person.

#### Scenario: Slot changed before the press
- **WHEN** a press arrives carrying the revision of an item that is no longer current
- **THEN** nothing is logged and the result sensor says the press was stale

#### Scenario: Last meal eaten
- **WHEN** the last of an on-hand meal is eaten
- **THEN** its buttons are removed from Home Assistant

### Requirement: Scale weigh-ins
The engine SHALL read weigh-ins from a configured MQTT topic (fed, for example, by Home Assistant's MQTT statestream or an automation that republishes the scale's state), map the scale's user to a Tare person from configuration, and count readings for the same scale user within 10 minutes once. A reading for an unmapped scale user SHALL become a question for the administrators. A reading outside 20 to 350 kg, or more than 3 kg from the person's trend, SHALL become a question for that person instead of a weight. When the person has no trend, or no reading in the last 30 days, only the 20 to 350 kg range applies. The real scale payload captured to design this SHALL stay outside the repository; committed fixtures are made up in its shape.

#### Scenario: Unmapped scale user
- **WHEN** a reading arrives for a scale user with no mapping
- **THEN** no weight is logged and the administrators get a question

#### Scenario: Repeat reading
- **WHEN** the scale publishes the same user's reading twice within 10 minutes
- **THEN** one weight is logged

#### Scenario: First reading for a new person
- **WHEN** a mapped person with no trend gets a reading of 72 kg
- **THEN** the weight is logged and starts their trend

#### Scenario: Implausible reading
- **WHEN** a mapped person with a trend of 80 kg gets a reading of 86 kg
- **THEN** no weight is logged and the person gets a question to confirm it

### Requirement: Weekly notice
When a recompute changes a person's calorie or protein target, the system SHALL notify the person through an MQTT event entity on their Home Assistant device and with a notice on the app's today screen, stored per person until they dismiss it.

#### Scenario: New weekly target
- **WHEN** the weekly recompute stores a target that differs from the previous one
- **THEN** a notice with the old and new target reaches Home Assistant and the app

#### Scenario: Unchanged target
- **WHEN** the weekly recompute stores the same target as before
- **THEN** no notice is sent

### Requirement: Documented household trust
The documentation SHALL state that everyone who can use a shared Home Assistant can press any person's buttons, and SHALL include an example dashboard.

#### Scenario: Setup docs
- **WHEN** an operator reads the Home Assistant setup guide
- **THEN** it states the shared-dashboard trust model and shows an example dashboard
