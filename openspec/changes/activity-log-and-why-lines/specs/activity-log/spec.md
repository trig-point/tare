## ADDED Requirements

### Requirement: Sessions with notes and sets
A person or their agent SHALL be able to log an activity session with optional notes and optional sets. Each set SHALL carry a set index, an exercise, and any of reps, load, duration and a reps-in-reserve range, plus optional notes. Loads SHALL always be stored in kilograms; a load given in pounds SHALL be converted, and the unit given SHALL be kept for display only. `replace_activity_sets` SHALL replace all sets of one of the person's sessions in one write transaction. `log_activity` and `replace_activity_sets` SHALL accept bodies up to 64 KB and SHALL reject more sets than fit in that limit with a stable code. A replayed `log_activity` with the same client id SHALL return the first result. A tracker's calories SHALL never be written to a logged session.

#### Scenario: Strength session with sets
- **WHEN** a person logs a strength session with three sets of 8 reps at 50 lb
- **THEN** the session and three sets are stored, each set's load is 22.68 kg, and the sets read back showing 50 lb

#### Scenario: Sets replaced
- **WHEN** the person replaces that session's sets with two sets
- **THEN** exactly those two sets remain and no other session changes

#### Scenario: Too many sets
- **WHEN** a request carries more sets than the cap
- **THEN** it is rejected with a stable code and nothing is stored

#### Scenario: Another person's session
- **WHEN** a person calls `replace_activity_sets` with a session id that belongs to someone else
- **THEN** it is rejected as not found and the other person's sets are unchanged

### Requirement: Session kinds and categories
Session kind SHALL stay free text. A fixed table SHALL map known kinds, including `sauna` and `cold_plunge` and the tracker's activity names, to one category of `strength`, `cardio`, `heat`, `cold` or `other`; an unknown kind SHALL be `other`.

#### Scenario: Sauna session
- **WHEN** a person logs a 20-minute session of kind `sauna`
- **THEN** it reads back with category `heat`

#### Scenario: Unknown kind
- **WHEN** a session of kind `paddleboard` is logged
- **THEN** it reads back with category `other`

### Requirement: Merged workouts
The system SHALL provide one merged-workout read. A logged session and a tracker session of the same category whose times overlap SHALL read as one workout, taking sets, notes and times from the logged session and calories from the tracker session; calories SHALL never be summed. The Body card, the body fat filter, why-lines and tier-two counts SHALL all use this read.

#### Scenario: Logged and tracked workout overlap
- **WHEN** a logged strength session from 6:00 to 7:00 PM overlaps a tracker strength workout from 6:05 to 6:55 PM with 310 kcal
- **THEN** the day has one workout with the logged sets, times 6:00 to 7:00 PM and 310 kcal

#### Scenario: Different categories
- **WHEN** a logged sauna session overlaps a tracker walk
- **THEN** they read as two entries

### Requirement: Habit notes
A person or their agent SHALL be able to log a context note for a day under a key from a fixed list, with an optional amount and an optional note, and delete it. The note SHALL have no yes or no value: no row means nothing was logged. Logging the same key for the same day SHALL replace the earlier note. An unknown key SHALL be rejected with a stable code.

#### Scenario: Alcohol logged
- **WHEN** a person logs `alcohol` with amount 2 for a day
- **THEN** that day shows the note with amount 2

#### Scenario: Logged again
- **WHEN** they log `alcohol` with amount 3 for the same day
- **THEN** one note remains, with amount 3

#### Scenario: Nothing logged
- **WHEN** a day has no `alcohol` note
- **THEN** it reads as nothing logged, never as no alcohol

### Requirement: Body card activity
The Body card SHALL list the day's merged workouts with their sets, the day's other sessions and its habit notes, and SHALL let the person log a session with sets, a sauna or cold plunge session and a habit note, and edit or delete them.

#### Scenario: Logging from the card
- **WHEN** a person logs a sauna session from the Body card
- **THEN** it appears in that day's list with category heat

#### Scenario: Day with nothing logged
- **WHEN** a day has no sessions and no notes
- **THEN** the card shows that nothing is logged and offers the log controls
