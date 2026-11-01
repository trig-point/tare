## ADDED Requirements

### Requirement: Formula target
From a person's profile (height, birth date, sex, activity level, goal rate and protein factor) the system SHALL compute a daily calorie target and a protein target, and today SHALL show what remains. The resting rate SHALL use the Mifflin-St Jeor equation: 10 times weight in kg, plus 6.25 times height in cm, minus 5 times age in whole years, plus 5 for male or minus 161 for female, with weight taken from the current weight trend. The activity factor SHALL be 1.2 (sedentary), 1.375 (light), 1.55 (moderate), 1.725 (active) or 1.9 (very active). The goal adjustment SHALL be the goal rate in kg per week times 7,700 divided by 7. The protein target SHALL be the protein factor (default 1.6 g per kg) times the trend weight. The calorie target SHALL be rounded to the nearest 10 kcal and the protein target to the nearest gram. Until the person's first weigh-in there SHALL be no target, and today SHALL ask for a weigh-in.

#### Scenario: Profile complete
- **WHEN** a person with at least one weigh-in completes their profile
- **THEN** today shows a calorie and protein target and the remaining amounts

#### Scenario: No weigh-in yet
- **WHEN** a person completes their profile before their first weigh-in
- **THEN** today shows no target and asks for a weigh-in

#### Scenario: Worked example
- **WHEN** a made-up male, 180 cm, age 40, trend weight 80.0 kg, moderate activity, goal rate minus 0.5 kg per week and the default protein factor has his target computed
- **THEN** the resting rate is 1,730 kcal, the calorie target is 2,130 kcal (1,730 times 1.55 minus 550, rounded) and the protein target is 128 g

### Requirement: Profile and target screens
The app SHALL let a person enter and edit their profile, and SHALL show a target card (target, eaten and remaining calories and protein, or the learning state) and a chart of weigh-ins with the weight trend.

#### Scenario: Profile entered in the app
- **WHEN** a person fills in the profile form and has a weigh-in
- **THEN** the target card shows their calorie and protein target

#### Scenario: Trend chart
- **WHEN** a person with weigh-ins opens the weight chart
- **THEN** it shows each day's first reading and the trend line

### Requirement: Weight trend
The system SHALL compute a weight trend by exponential smoothing with a factor of 0.1: on a day with a reading (days follow the person's day rule), the trend moves 0.1 of the way from yesterday's trend to the day's first reading; on a day without one it holds. The first reading starts the trend. Readings SHALL never be invented for days without one, and the trend SHALL be recomputed when a past reading is added, edited or deleted.

#### Scenario: New reading
- **WHEN** the trend is 80.0 kg and the day's first reading is 81.0 kg
- **THEN** the trend becomes 80.1 kg

#### Scenario: Gap in weigh-ins
- **WHEN** a person with a trend of 80.1 kg has no weigh-ins for five days and then reads 79.6 kg
- **THEN** the trend holds at 80.1 kg through the gap and then becomes 80.05 kg

### Requirement: Adaptive TDEE from signed-off days
The system SHALL estimate TDEE by energy balance over a window of the 28 days ending yesterday. Mean intake SHALL be the total intake of the signed-off days in the window divided by the number of those days. The weight rate SHALL be the trend on the window's last day minus the trend at the start of the span, divided by the elapsed days of the span, so weight is measured over elapsed days whether or not each day was signed off. The span starts on the day before the window's first day when the trend existed then, and otherwise on the trend's first day inside the window. The estimate SHALL be mean intake minus the weight rate times 7,700 kcal per kg. Low and high bounds SHALL be computed the same way with each `estimated` entry replaced by its stored low and high values, or by 25 percent below and above when it has none. The estimate SHALL be eligible once the window has at least 14 signed-off days, weigh-ins on at least 8 days, and a span of at least 14 days; until then the formula target stays in force and the target shows a learning state. The window length, energy density, eligibility counts, minimum span and default range SHALL be configuration with these defaults.

#### Scenario: Worked estimate
- **WHEN** a window has 20 signed-off days totalling 48,000 kcal and the trend falls from 90.0 kg to 89.0 kg across it
- **THEN** mean intake is 2,400 kcal, the weight rate is minus 1/28 kg per day, and the estimate is 2,675 kcal (2,400 plus 275)

#### Scenario: Estimated intake widens the bounds
- **WHEN** that window's `estimated` entries have stored lows totalling 300 kcal below their values and highs totalling 600 kcal above
- **THEN** the bounds are 2,660 kcal and 2,705 kcal

#### Scenario: First weigh-in inside the window
- **WHEN** a person's trend starts on the window's 8th day at 85.0 kg and is 84.2 kg on its 28th day, and the window has 16 signed-off days totalling 35,200 kcal and weigh-ins on 10 days
- **THEN** the span is 20 days, the weight rate is minus 0.04 kg per day, and the estimate is 2,508 kcal (2,200 plus 308)

#### Scenario: Span too short
- **WHEN** a person's trend starts on the window's 20th day
- **THEN** the span is 8 days, the estimate is not eligible, and the target shows it is learning

#### Scenario: Unsigned days
- **WHEN** a window contains days that are not signed off
- **THEN** their intake is left out of the mean while the weight rate still spans the whole window

#### Scenario: Not enough data
- **WHEN** fewer signed-off days or weigh-in days exist than the minimum
- **THEN** the formula target stays in force and the target shows it is learning

### Requirement: Weekly recompute
The system SHALL recompute and store each person's targets in a weekly job on a configured weekday (default Monday) in the install's timezone, and again whenever the person's profile or goal changes. The stored calorie target SHALL be the eligible estimate plus the goal adjustment (the goal rate in kg per week times 7,700 divided by 7), rounded as the formula target is, or the formula target while the estimate is not eligible; the protein target is the formula's. Today's target, the slot budgets and the Home Assistant target sensors SHALL all read the latest stored target through one target reader, which uses the live formula target until the first recompute.

#### Scenario: Week rolls over
- **WHEN** the weekly recompute runs
- **THEN** a new target is stored with the estimate and bounds it came from, or with a note that the formula was used

#### Scenario: Adaptive target takes over
- **WHEN** a recompute finds an eligible estimate of 2,675 kcal for a person whose goal rate is minus 0.25 kg per week
- **THEN** the stored target is 2,400 kcal (2,675 minus 275) and today shows 2,400 kcal as the target

#### Scenario: Goal changed mid-week
- **WHEN** a person changes their goal rate on a Thursday
- **THEN** their target is recomputed and stored that day

### Requirement: Weekly target notice in the app
When a recompute changes a person's calorie or protein target, the app's today screen SHALL show a notice with the old and new target, stored per person until they dismiss it.

#### Scenario: Notice shown
- **WHEN** a recompute changes a person's target
- **THEN** their today screen shows a notice with the old and new target

#### Scenario: Notice dismissed
- **WHEN** the person dismisses the notice
- **THEN** it does not return on that device or any other, until the next change
