## ADDED Requirements

### Requirement: Sessions with timing, notes and sets
A person or their agent SHALL be able to log an activity session with optional notes and optional sets, written in one transaction. A session SHALL have a timing of `exact` (the default) or `date_only`. An exact session SHALL require a start time and a positive duration. A date-only session SHALL take a day and SHALL refuse a start time and a duration, which SHALL be stored as NULL; no placeholder time SHALL ever be stored. Every reader SHALL handle a NULL start and duration, listing date-only sessions after timed ones. Tracker sessions SHALL always be exact.

Each set SHALL carry a set index from 1, a nonblank exercise, a set type of warmup, working, drop or failure (default working), and any of reps, load, duration in seconds, a reps-in-reserve range from 0 to 10 with low at most high, and notes. Loads SHALL be stored in kilograms, 0 or more; a load given in pounds SHALL be converted before it is stored, and the unit given SHALL be kept for display only.

`log_activity` and `replace_activity_sets` SHALL accept requests up to 60,000 bytes over HTTP and MCP and SHALL reject more sets than fit with a stable code. A replayed `log_activity` with the same client id SHALL return the stored session and write nothing. `replace_activity_sets` SHALL be a full replacement of one session's sets in one transaction: an identical retry SHALL leave the same set list, and an empty list SHALL remove all sets. Writes to, or reads of, another person's session SHALL fail and change no rows. A session's calories SHALL stay the tracker's estimate and SHALL never be added to daily burn, intake or the target.

#### Scenario: Strength session with sets
- **WHEN** a person logs an exact strength session with three working sets of 8 reps at 50 lb with 3 to 4 reps in reserve
- **THEN** the session and three sets are stored, each set's load is 22.68 kg, and the sets read back showing 50 lb and the range 3 to 4

#### Scenario: Date-only session
- **WHEN** a session is logged with timing `date_only`, a day and two sets
- **THEN** it is stored with no start time and no duration and lists after that day's timed sessions

#### Scenario: Date-only session with a time
- **WHEN** a date-only session also carries a start time
- **THEN** it is rejected and nothing is stored

#### Scenario: Largest allowed session over both transports
- **WHEN** the largest allowed session is posted over HTTP and over MCP
- **THEN** both are stored, and one more set is rejected with a stable code

#### Scenario: Replacement retried
- **WHEN** the same replacement of a session's sets is sent twice
- **THEN** the set list is the same after each, with no duplicates

#### Scenario: Another person's session
- **WHEN** a person logs sets against, replaces the sets of (with an empty list or not), or reads a session that belongs to someone else
- **THEN** the call fails and no row changes

### Requirement: Session kinds and categories
Session kind SHALL stay free text, with `sauna` and `cold_plunge` as the kinds for those sessions. A fixed list SHALL map each kind, and each tracker activity name through a fixed table, to one category of `strength`, `cardio`, `sauna`, `cold_plunge` or `other`. An unknown kind or activity name SHALL map to `other`, SHALL be shown as an unpaired row, SHALL be counted in telemetry, and SHALL never be dropped.

#### Scenario: Sauna session
- **WHEN** a person logs a 20-minute session of kind `sauna`
- **THEN** it reads back with category `sauna`

#### Scenario: Unknown tracker activity
- **WHEN** a tracker workout arrives with an activity name not in the table
- **THEN** it is stored, shown unpaired with category `other`, and counted in telemetry

### Requirement: Merged workouts
The system SHALL provide one merged-workouts read, returned by `read_activities` for a date range and by `read_signals` in place of its raw session list. A pair SHALL be one tracker session (any source other than `manual` and `agent`) and one exact logged session (`manual` or `agent`) of the same category whose times overlap. Matching SHALL be one-to-one: for each logged session in start order, the unpaired overlapping tracker session with the largest overlap SHALL be taken, ties going to the earlier tracker start and then the lower id. In a pair the logged session SHALL supply sets, notes, start and duration and the tracker session SHALL supply calories; calories SHALL never be summed. Date-only sessions SHALL never be paired. Unpaired sessions SHALL be shown as they are. The Body card, the body fat trend and the why-lines SHALL all use this read. A raw-session read MAY exist only as a separately named operation.

#### Scenario: Logged and tracked workout overlap
- **WHEN** a logged strength session from 6:00 to 7:00 PM overlaps a tracker strength workout from 6:05 to 6:55 PM with 310 kcal
- **THEN** the day has one workout with the logged sets, a 6:00 PM start, 60 minutes and 310 kcal

#### Scenario: Two tracker sessions overlap one logged session
- **WHEN** a logged session overlaps tracker sessions by 40 and 10 minutes
- **THEN** it pairs with the 40-minute one and the other is shown unpaired

#### Scenario: Different categories
- **WHEN** a logged sauna session overlaps a tracker walk
- **THEN** they read as two entries

#### Scenario: Date-only session is never paired
- **WHEN** a date-only strength session and a tracker strength workout fall on the same day
- **THEN** they read as two entries

### Requirement: Habit notes
A person or their agent SHALL be able to log a habit note for a day under a key from a fixed list (`evening_alcohol` and `late_caffeine` to start), with an optional amount and an optional note, through `log_habit`, and SHALL undo it with `delete_habit`, which removes the row. A note SHALL record its source and updated time. A row SHALL mean the habit happened; there SHALL be no done value and no "no" row, and a day without a row SHALL read as not logged. Logging the same key for the same day SHALL update the row. An unknown key SHALL be rejected with a stable code. A late hard workout SHALL be read from session times, never logged as a habit.

#### Scenario: Alcohol logged
- **WHEN** a person logs `evening_alcohol` with amount 2 for a day
- **THEN** that day shows the note with amount 2

#### Scenario: Logged again
- **WHEN** they log `evening_alcohol` with amount 3 for the same day
- **THEN** one note remains, with amount 3

#### Scenario: Undone
- **WHEN** they delete it
- **THEN** the day reads as not logged, never as no alcohol

### Requirement: Body card activity
The Body card SHALL show the day's merged workouts with their sets, each workout once, its other sessions and its habit notes, with "time not recorded" for a date-only session. It SHALL let the person quickly log a sauna, a cold plunge or a habit, enter a workout with sets by hand, and edit or delete them; each new entry SHALL send a client id kept across retries. After a log, the today, plan and signals queries SHALL refresh together.

#### Scenario: Quick log from the card
- **WHEN** a person logs a sauna from the Body card
- **THEN** it appears in that day's list and the today, plan and signals views refresh

#### Scenario: Retried entry
- **WHEN** a hand-entered workout is retried after a network error
- **THEN** the same client id is sent and one session is stored

#### Scenario: Day with nothing logged
- **WHEN** a day has no sessions and no notes
- **THEN** the card shows that nothing is logged and offers the log controls
