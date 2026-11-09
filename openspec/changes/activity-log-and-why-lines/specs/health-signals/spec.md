## MODIFIED Requirements

### Requirement: Daily signals store
The system SHALL store daily health signals per person in a fixed vocabulary (steps, active calories, sleep, resting heart rate, HRV, readiness, stress, activity sessions) with their source, and the app SHALL show them beside that day's intake. Signals SHALL NOT change the calorie target in version 1, except that active calories from one tracker source SHALL adjust the day's target through the activity adjustment in the daily-target capability. Active calories logged by hand (manual or agent) SHALL be shown but SHALL never adjust the target. No other signal, no session, no session's calories and no habit note SHALL change the target.

#### Scenario: Signal shown, target unchanged
- **WHEN** a day's HRV or sleep arrives
- **THEN** it appears beside that day's intake and the target is unchanged

#### Scenario: Active calories adjust the day only
- **WHEN** today's active calories arrive from the source the adjustment uses
- **THEN** they appear beside today's intake, today's target changes only through the activity adjustment, and the stored weekly target is unchanged

#### Scenario: Sessions never move the target
- **WHEN** a session with calories and a habit note are recorded for today
- **THEN** today's target is the same as before they were recorded

### Requirement: Oura daily sync
An hourly job SHALL fetch each connected person's data from Oura's daily_activity, daily_sleep, sleep, daily_readiness, daily_stress and workout endpoints, map it into the signals vocabulary, and record when each person's source last synced. Each run SHALL upsert by person, source and date for daily values, and by the source's record id for sleep periods and activity sessions, which can be several a day, so a retry or overlapping run stores nothing twice, and SHALL advance a person's last sync only after their data is stored.

#### Scenario: Sync after the ring app syncs
- **WHEN** the hourly job runs after the person's ring data has synced
- **THEN** that day's sleep, readiness and activity signals are stored and the last-sync time updates

#### Scenario: Hourly runs store nothing twice
- **WHEN** two hourly runs fetch the same days
- **THEN** each signal, sleep period and session is stored once
