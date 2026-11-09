## ADDED Requirements

### Requirement: Tier-one why-lines
For burn, HRV, resting heart rate and sleep, the system SHALL compare the day's value with its baseline: the 28 days before that day, excluding the day itself. No line SHALL be shown with fewer than 14 baseline days of that signal or when the baseline's standard deviation is zero. A signal SHALL fire when it is more than 1 standard deviation from the baseline mean and, for HRV, also at least 10 percent from it. Burn lines SHALL use every burn source, hand-entered included, each compared with its own baseline and labelled with its source. When a signal fires, the system SHALL show every candidate from this fixed list that matches, each in its fixed template, and SHALL never say "because":
- burn up, with a strength or cardio session that day: "Burn <today> kcal, above your usual <baseline>. You logged a <minutes>-minute workout.";
- HRV down or resting heart rate up, with a strength or cardio session of 30 minutes or more ending within 4 hours of sleep start: "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV.";
- HRV down, with `evening_alcohol` logged the evening before: "You logged alcohol last evening. Alcohol is linked to lower HRV.";
- HRV or resting heart rate changed in either direction, with sauna or cold plunge the day before: "You logged sauna yesterday. Its effect on HRV is not settled." or "You logged cold plunge yesterday. Its effect on HRV is not settled."

"The day or night before" SHALL mean sessions that ended after the previous main sleep ended and before this night's main sleep started, where the main sleep is the day's longest sleep period. An evening habit logged for day D SHALL belong to the night that starts on D. Date-only sessions SHALL count only in rules keyed to the day and SHALL be skipped by every rule that needs a time. General-finding sentences SHALL carry no numbers. Lines SHALL be computed on the server and returned in `read_signals` as a `why` list per signal, and the Body card SHALL show them. The thresholds SHALL be configuration with these defaults.

#### Scenario: Late workout and low HRV
- **WHEN** HRV is 1.5 standard deviations and 15 percent below baseline and a 45-minute strength session ended 2 hours before sleep start
- **THEN** HRV's `why` list has "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV."

#### Scenario: Date-only session skipped by timing rules
- **WHEN** HRV fires low on a night after a date-only strength session
- **THEN** no late-workout line is shown

#### Scenario: Burn up from hand-entered burn
- **WHEN** a manual burn entry of 640 kcal is more than 1 standard deviation above that source's baseline of 430 kcal and a 55-minute workout was logged that day
- **THEN** burn's `why` list has "Burn 640 kcal, above your usual 430. You logged a 55-minute workout." labelled with the manual source

#### Scenario: Sauna yesterday
- **WHEN** resting heart rate fires and sauna was logged the day before
- **THEN** its `why` list has "You logged sauna yesterday. Its effect on HRV is not settled."

#### Scenario: Two candidates
- **WHEN** HRV fires low and both evening alcohol and a late workout were logged the evening before
- **THEN** both lines are shown

#### Scenario: Short or flat baseline
- **WHEN** a signal has 10 baseline days, or every baseline day has the same value
- **THEN** no line is shown for it

### Requirement: Tier-two patterns
Once an item has at least 5 logged days and 5 days without a log in the last 90, each with the signal present, the system SHALL show the person's own average for that signal on the nights after logged days against the nights after days without a log, with both counts and a small-sample caveat: "Nights after a logged sauna: HRV averaged 8% higher than nights without one logged (8 vs 21 nights). Small sample; days you log may differ from days you don't in other ways." A difference under 10 percent SHALL read "no clear difference yet". The comparison SHALL be worded as logged against without a log, never as did against did not. No significance test SHALL be applied. A personal pattern SHALL replace the tier-one wording for that item, and SHALL never say "because". Date-only sessions SHALL count as logged days.

#### Scenario: Enough days
- **WHEN** sauna was logged on 8 of the last 90 days and HRV averaged 8 percent higher on the following nights than on 21 nights without one logged
- **THEN** the card shows the line with "(8 vs 21 nights)" and the small-sample caveat

#### Scenario: Small difference
- **WHEN** the difference is 4 percent
- **THEN** the line reads "no clear difference yet" with both counts

#### Scenario: Too few days
- **WHEN** sauna was logged on 4 days
- **THEN** no tier-two line is shown for sauna and the tier-one wording stays

### Requirement: Body fat trend
The system SHALL store and show every scale body fat reading through a body fat history read. The trend SHALL use the first weigh-in of each day. A reading within 12 hours after the end of a timed merged workout or sauna session SHALL be shown marked "after a workout" and left out of the trend; a date-only session SHALL never exclude a reading. The current level SHALL be the median of the trend readings in the last 28 days, and the trend SHALL be the change from the median of the 28 days before them. Each window SHALL need at least 8 trend readings; with fewer, the card SHALL show the readings and say "not enough readings for a trend". A change under 2 points SHALL read "within this scale's error of about 2 points". The system SHALL never call a body fat change fat or muscle on the reading alone; it SHALL state it beside the training log and weight trend in one line.

#### Scenario: Post-workout reading
- **WHEN** the day's first weigh-in comes 3 hours after a timed workout ended
- **THEN** it is shown marked "after a workout" and left out of the trend

#### Scenario: Date-only session
- **WHEN** a weigh-in falls on the morning after a date-only session
- **THEN** it stays in the trend

#### Scenario: Too few readings
- **WHEN** a window has 6 trend readings
- **THEN** the card shows the readings and says "not enough readings for a trend"

#### Scenario: Small change
- **WHEN** the level moves 1.2 points from the prior window
- **THEN** the card says it is within this scale's error of about 2 points

#### Scenario: Joined line
- **WHEN** no strength sessions are logged in 3 weeks, the weight trend is down 1.2 kg and the body fat level is up 1 point
- **THEN** the card shows "No strength sessions logged in 3 weeks. Weight down 1.2 kg. Body fat reading up 1 point, within this scale's error."

#### Scenario: No body fat readings
- **WHEN** a person's scale never reports body fat
- **THEN** the card shows no body fat trend
