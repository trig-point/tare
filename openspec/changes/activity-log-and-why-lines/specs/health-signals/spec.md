## MODIFIED Requirements

### Requirement: Daily signals store
The system SHALL store daily health signals per person in a fixed vocabulary (steps, active calories, sleep, resting heart rate, HRV, readiness, stress, activity sessions) with their source, and the app SHALL show them beside that day's intake. Signals SHALL NOT change the calorie target in version 1, except that one source's active calories SHALL change today's target through the activity adjustment in the daily-target capability. No other signal, no session's calories and no habit note SHALL change the target.

#### Scenario: Signal shown, target unchanged
- **WHEN** a day's resting heart rate arrives
- **THEN** it appears beside that day's intake and the target is unchanged

#### Scenario: Active calories adjust today only
- **WHEN** today's active calories arrive from the source the adjustment uses
- **THEN** they appear beside today's intake, today's target changes by the activity adjustment, and the stored weekly target is unchanged

#### Scenario: Session calories never move the target
- **WHEN** a logged session with calories and a habit note are recorded for today
- **THEN** today's target is the same as before they were recorded

### Requirement: Oura daily sync
An hourly job SHALL fetch each connected person's data from Oura's daily_activity, daily_sleep, sleep, daily_readiness, daily_stress and workout endpoints, map it into the signals vocabulary, and record when each person's source last synced. After a person's first full sync, each run SHALL fetch only today and yesterday in the person's own day. Each run SHALL upsert by person, source and date for daily values, and by the source's record id for sleep periods and activity sessions, which can be several a day, so a retry or overlapping run stores nothing twice, and SHALL advance a person's last sync only after their data is stored. Each run SHALL also store an intraday burn sample of today's cumulative active calories, upserted by person, source and observed minute.

#### Scenario: Sync after the ring app syncs
- **WHEN** the hourly job runs after the person's ring data has synced
- **THEN** that day's sleep, readiness and activity signals are stored, a burn sample is stored, and the last-sync time updates

#### Scenario: Retry within the same minute
- **WHEN** a run is retried within the same minute
- **THEN** no signal, session or burn sample is stored twice
