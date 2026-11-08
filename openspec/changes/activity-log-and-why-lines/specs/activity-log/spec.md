## ADDED Requirements

### Requirement: Sessions with notes and sets
A person or their agent SHALL be able to log an activity session with optional notes and optional sets, written in one transaction. Each set SHALL carry a set index from 1, a nonblank exercise, a set type of warmup, working, drop or failure (default working), and any of reps, load, duration in seconds, a reps-in-reserve range from 0 to 10 with low at most high, and notes. Loads SHALL always be stored in kilograms, 0 or more; a load given in pounds SHALL be converted before it is stored, and the unit given SHALL be kept for display only. `replace_activity_sets` SHALL replace all sets of one session the person owns in one transaction. `read_activities` SHALL return the person's sessions with their sets for a date range. `log_activity` and `replace_activity_sets` SHALL accept bodies up to 64 KB and SHALL reject more sets than fit in that limit with a stable code. A replayed `log_activity` with the same client id SHALL return the stored session and write nothing. A session's calories SHALL stay the tracker's estimate for that workout and SHALL never be added to daily burn, intake or the target.

#### Scenario: Strength session with sets
- **WHEN** a person logs a strength session with three working sets of 8 reps at 50 lb with 3 to 4 reps in reserve
- **THEN** the session and three sets are stored, each set's load is 22.68 kg, and the sets read back showing 50 lb and the range 3 to 4

#### Scenario: Sets replaced
- **WHEN** the person replaces that session's sets with two sets
- **THEN** exactly those two sets remain and no other session changes

#### Scenario: Too many sets
- **WHEN** a request carries more sets than the cap
- **THEN** it is rejected with a stable code and nothing is stored

#### Scenario: Invalid reps-in-reserve range
- **WHEN** a set has reps in reserve from 4 to 3
- **THEN** the request is rejected and nothing is stored

#### Scenario: Another person's session
- **WHEN** a person calls `replace_activity_sets` with a session id that belongs to someone else
- **THEN** it is rejected as not found and the other person's sets are unchanged

### Requirement: Session kinds and categories
Session kind SHALL stay free text, with `sauna` and `cold_plunge` as the kinds for those sessions. A fixed list SHALL map each kind, and each of the tracker's activity names through a fixed table, to one category of `strength`, `cardio`, `sauna`, `cold_plunge` or `other`. An unknown kind or activity name SHALL map to `other`, SHALL be counted in telemetry, and SHALL never be rejected.

#### Scenario: Sauna session
- **WHEN** a person logs a 20-minute session of kind `sauna`
- **THEN** it reads back with category `sauna`

#### Scenario: Unknown tracker activity
- **WHEN** a tracker workout arrives with an activity name not in the table
- **THEN** it is stored, reads back with category `other`, and is counted in telemetry

### Requirement: Merged workouts
The system SHALL provide one merged-workouts read. A tracker session and a manual session SHALL read as one workout when their categories match and their times overlap, taking sets, start and duration from the logged session and calories from the tracker session; calories SHALL never be summed. The rows SHALL stay separate in storage. The Body card, the body fat trend and the why-lines SHALL all use this read.

#### Scenario: Logged and tracked workout overlap
- **WHEN** a logged strength session from 6:00 to 7:00 PM overlaps a tracker strength workout from 6:05 to 6:55 PM with 310 kcal
- **THEN** the day has one workout with the logged sets, a 6:00 PM start, 60 minutes and 310 kcal

#### Scenario: Different categories
- **WHEN** a logged sauna session overlaps a tracker walk
- **THEN** they read as two entries

### Requirement: Habit notes
A person or their agent SHALL be able to log a habit note for a day under a key from a fixed list (`evening_alcohol` and `late_caffeine` to start), with an optional amount and an optional note, and SHALL be able to undo it by deleting the row. A note SHALL record its source. A row SHALL mean the habit happened; there SHALL be no done value and no "no" row, and a day without a row SHALL read as not logged. Logging the same key for the same day SHALL replace the earlier note. An unknown key SHALL be rejected with a stable code. A late hard workout SHALL be read from session times, never logged as a habit.

#### Scenario: Alcohol logged
- **WHEN** a person logs `evening_alcohol` with amount 2 for a day
- **THEN** that day shows the note with amount 2

#### Scenario: Logged again
- **WHEN** they log `evening_alcohol` with amount 3 for the same day
- **THEN** one note remains, with amount 3

#### Scenario: Not logged
- **WHEN** a day has no `evening_alcohol` note
- **THEN** it reads as not logged, never as no alcohol

### Requirement: Body card activity
The Body card SHALL show the day's merged workouts with their sets, its other sessions and its habit notes, and SHALL let the person quickly log a sauna, a cold plunge or a habit, enter a workout with sets by hand, and edit or delete them.

#### Scenario: Quick log from the card
- **WHEN** a person logs a sauna from the Body card
- **THEN** it appears in that day's list

#### Scenario: Day with nothing logged
- **WHEN** a day has no sessions and no notes
- **THEN** the card shows that nothing is logged and offers the log controls
