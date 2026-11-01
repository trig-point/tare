## ADDED Requirements

### Requirement: Daily signals store
The system SHALL store daily health signals per person in a fixed vocabulary (steps, active calories, sleep, resting heart rate, HRV, readiness, stress, activity sessions) with their source, and SHALL show them next to intake. Signals SHALL NOT change the calorie target in version 1.

#### Scenario: Signal shown, target unchanged
- **WHEN** a day's active calories arrive
- **THEN** they appear beside that day's intake and the target is unchanged

### Requirement: Manual and agent entry
A person or their agent SHALL be able to record a signal or an activity session.

#### Scenario: Agent logs a workout
- **WHEN** an agent records an activity session
- **THEN** it appears in that day's signals with the agent as its source

### Requirement: Oura connection
Each install SHALL use its own Oura OAuth app from configuration. Each person SHALL connect their own Oura account. Token refresh SHALL run under a per-person lock and save both new tokens atomically. A missing Oura membership SHALL be reported separately from an authorization failure.

#### Scenario: Concurrent refresh
- **WHEN** two jobs try to refresh the same person's token at once
- **THEN** one refresh runs and both use its result

#### Scenario: No membership
- **WHEN** Oura refuses data because the person has no active membership
- **THEN** the app says membership is required rather than asking them to reconnect

### Requirement: Oura daily sync
A daily job SHALL fetch each connected person's documented daily fields and map them into the signals vocabulary, and SHALL show when each source last synced.

#### Scenario: Sync after the ring app syncs
- **WHEN** the daily job runs after the person's ring data has synced
- **THEN** that day's sleep, readiness and activity signals are stored
