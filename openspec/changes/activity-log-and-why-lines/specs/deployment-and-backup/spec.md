## MODIFIED Requirements

### Requirement: Scheduled jobs
The engine SHALL run its scheduled jobs (all four: the nightly backup, the daily job that records meal-kit deliveries that have come due, the weekly recompute and the Oura daily sync) in-process on daily or weekly schedules in the install's configured timezone, except that the Oura sync SHALL run hourly when the activity credit mode is `same-day`, run at most one instance of each job at a time, and record each job's last run and result. Schedules and overrun protection SHALL come from croner, whose protect callback records a blocked run as skipped.

#### Scenario: Overlapping run
- **WHEN** a job is still running when its next run is due
- **THEN** the second run is skipped and recorded as skipped

#### Scenario: Hourly Oura sync in same-day mode
- **WHEN** the activity credit mode is `same-day`
- **THEN** the Oura sync runs every hour and the other jobs keep their daily or weekly schedules
