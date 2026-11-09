## MODIFIED Requirements

### Requirement: Daily signals store
The system SHALL store daily health signals per person in a fixed vocabulary (steps, active calories, sleep, resting heart rate, HRV, readiness, stress, activity sessions) with their source, and the app SHALL show them beside that day's intake. Signals SHALL NOT change the calorie target in version 1, except that active calories from one eligible tracker source SHALL raise the day's target through the activity bonus in the daily-target capability. No other signal, no `manual` or `agent` active calories written through `log_signal`, no session and no session's calories SHALL change the target.

#### Scenario: Signal shown, target unchanged
- **WHEN** a day's HRV, sleep or hand-entered active calories arrive
- **THEN** they appear beside that day's intake and the target is unchanged

#### Scenario: Tracker burn raises the day only
- **WHEN** active calories arrive from the selected tracker source
- **THEN** they appear beside the day's intake, the day's target changes only through the activity bonus, and the stored weekly target is unchanged

### Requirement: Oura daily sync
A job SHALL fetch each connected person's data from Oura's daily_activity, daily_sleep, sleep, daily_readiness, daily_stress and workout endpoints, map it into the signals vocabulary, and record when each person's source last synced. The job SHALL run hourly when the activity credit mode is same-day and daily at 7:00 when it is next-day. Each run SHALL upsert by person, source and date for daily values, and by the source's record id for sleep periods and activity sessions, which can be several a day, so a retry or overlapping run stores nothing twice, and SHALL advance a person's last sync only after their data is stored.

#### Scenario: Sync after the ring app syncs
- **WHEN** the job runs after the person's ring data has synced
- **THEN** that day's sleep, readiness and activity signals are stored and the last-sync time updates

#### Scenario: Same-day mode runs hourly
- **WHEN** the credit mode is same-day
- **THEN** the job runs every hour and two runs over the same days store each signal, sleep period and session once
