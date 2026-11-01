## ADDED Requirements

### Requirement: Daily signals store
The system SHALL store daily health signals per person in a fixed vocabulary (steps, active calories, sleep, resting heart rate, HRV, readiness, stress, activity sessions) with their source, and the app SHALL show them beside that day's intake. Signals SHALL NOT change the calorie target in version 1.

#### Scenario: Signal shown, target unchanged
- **WHEN** a day's active calories arrive
- **THEN** they appear beside that day's intake and the target is unchanged

### Requirement: Manual and agent entry
A person or their agent SHALL be able to record a signal or an activity session.

#### Scenario: Agent logs a workout
- **WHEN** an agent records an activity session
- **THEN** it appears in that day's signals with the agent as its source

### Requirement: Oura connection
Each install SHALL use its own Oura OAuth app from configuration, and each person SHALL connect their own Oura account. Starting a connection SHALL create a random, single-use state value stored on the server with the person who started it and expiring after 10 minutes; the callback SHALL be rejected when its state is missing, expired, used or belongs to another person. Oura tokens SHALL be stored encrypted with a secret key from configuration; a restore without that key SHALL keep all other data and mark each Oura connection as needing reconnection. Token refresh SHALL run under a per-person lock and save both new tokens atomically. A missing Oura membership SHALL be reported separately from an authorization failure.

#### Scenario: Concurrent refresh
- **WHEN** two jobs try to refresh the same person's token at once
- **THEN** one refresh runs and both use its result

#### Scenario: No membership
- **WHEN** Oura refuses data because the person has no active membership
- **THEN** the app says membership is required rather than asking them to reconnect

#### Scenario: Callback with someone else's state
- **WHEN** person B's browser completes a callback carrying the state person A started
- **THEN** the callback is rejected and no token is stored for either person

#### Scenario: Restore without the key
- **WHEN** a backup is restored with a different secret key
- **THEN** intake, weights and signals are intact and each Oura connection shows that it needs reconnecting

### Requirement: Oura daily sync
A daily job SHALL fetch each connected person's data from Oura's daily_activity, daily_sleep, sleep, daily_readiness, daily_stress and workout endpoints, map it into the signals vocabulary, and record when each person's source last synced. Each run SHALL upsert by person, source and date (and by the source's session id for activity sessions), so a retry or overlapping run stores nothing twice, and SHALL advance a person's last sync only after their data is stored.

#### Scenario: Sync after the ring app syncs
- **WHEN** the daily job runs after the person's ring data has synced
- **THEN** that day's sleep, readiness and activity signals are stored and the last-sync time updates
