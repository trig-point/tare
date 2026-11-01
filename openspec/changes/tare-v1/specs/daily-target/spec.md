## ADDED Requirements

### Requirement: Formula target
From a person's profile (height, birth date, sex, activity level, goal rate) the system SHALL compute a daily calorie target with the Mifflin-St Jeor equation and an activity factor, plus a protein target, and today SHALL show what remains.

#### Scenario: Profile complete
- **WHEN** a person completes their profile
- **THEN** today shows a calorie and protein target and the remaining amounts

### Requirement: Weight trend
The system SHALL compute a smoothed weight trend from weigh-ins and handle gaps without inventing readings.

#### Scenario: Gap in weigh-ins
- **WHEN** a person has no weigh-ins for several days
- **THEN** the trend holds its last value and resumes when readings return

### Requirement: Adaptive TDEE from signed-off days
The system SHALL estimate TDEE by energy balance over a rolling window of signed-off days only, widen the uncertainty when intake is `estimated`, and keep the formula target until a minimum-data rule is met, showing a learning state meanwhile.

#### Scenario: Unsigned days
- **WHEN** a window contains days that are not signed off
- **THEN** those days are left out of the estimate

#### Scenario: Not enough data
- **WHEN** fewer signed-off days exist than the minimum
- **THEN** the formula target stays in force and the target shows it is learning

### Requirement: Weekly recompute
The system SHALL recompute and store each person's targets weekly from the current estimate and goal.

#### Scenario: Week rolls over
- **WHEN** the weekly recompute runs
- **THEN** a new target is stored with the estimate it came from
