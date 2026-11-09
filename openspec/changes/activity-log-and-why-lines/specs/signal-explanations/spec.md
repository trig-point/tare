## ADDED Requirements

### Requirement: Tier-one why-lines
For burn, HRV, resting heart rate and sleep, the system SHALL compare the day's value with its baseline: the 28 days before that day, excluding the day itself. No line SHALL be shown with fewer than 14 baseline days of that signal or when the baseline's standard deviation is zero. A signal SHALL fire when it is more than 1 standard deviation from the baseline mean and, for HRV, also at least 10 percent from it. Burn lines SHALL use every burn source, hand-entered included, each compared with its own baseline. Each burn source's row SHALL carry its own `why` list, keyed on the server by metric and source, and the Body card SHALL show every active-calories source row, each labelled with its source, in the existing source ranking order. When a signal fires, the system SHALL show every candidate from this fixed list that matches, each in its fixed template, and SHALL never say "because":
- burn up, with a strength or cardio session that day, timed or date-only: "Burn <today> kcal, above your usual <baseline>. You logged a <minutes>-minute workout.", where <minutes> is the duration of the longest timed strength or cardio session that day; when only date-only sessions match: "Burn <today> kcal, above your usual <baseline>. You logged a workout.";
- HRV down or resting heart rate up, with a timed strength or cardio session of 30 minutes or more ending within 4 hours of sleep start: "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV.";
- HRV down, with `evening_alcohol` logged the evening before: "You logged alcohol last evening. Alcohol is linked to lower HRV.";
- HRV or resting heart rate changed in either direction, with a timed sauna or cold plunge session in the day or night before: "You logged <sauna | cold plunge> yesterday. Its effect on <HRV | resting heart rate> is not settled.", naming the session kind and the signal that fired.

"The day or night before" SHALL mean sessions that ended after the previous main sleep ended and before this night's main sleep started, where the main sleep is the day's longest sleep period. Because that window needs a time, a date-only session SHALL never match it, so a date-only sauna or cold plunge never triggers its line. An evening habit logged for day D SHALL belong to the night that starts on D. Date-only sessions SHALL count only in rules keyed to the day and SHALL be skipped by every rule that needs a time.

A firing signal with no matching candidate SHALL show no line. Sleep SHALL have no tier-one candidate in this change; its baseline is still computed, and sleep is used in tier two. `late_caffeine` SHALL match no tier-one rule and SHALL be used only in tier two.

General-finding sentences SHALL carry no numbers. Lines SHALL be computed on the server and returned in `read_signals` as a `why` list per signal, and the Body card SHALL show them. The thresholds SHALL be configuration with these defaults.

#### Scenario: Late workout and low HRV
- **WHEN** HRV is 1.5 standard deviations and 15 percent below baseline and a 45-minute strength session ended 2 hours before sleep start
- **THEN** HRV's `why` list has "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV."

#### Scenario: Date-only session skipped by timing rules
- **WHEN** HRV fires low on a night after a date-only strength session
- **THEN** no late-workout line is shown

#### Scenario: Burn up from hand-entered burn
- **WHEN** a manual burn entry of 640 kcal is more than 1 standard deviation above that source's baseline of 430 kcal, and timed workouts of 55 and 20 minutes were logged that day
- **THEN** burn's `why` list has "Burn 640 kcal, above your usual 430. You logged a 55-minute workout." labelled with the manual source

#### Scenario: Burn up with only a date-only session
- **WHEN** burn fires high at 640 kcal against a baseline of 430 kcal and the day's only strength or cardio session is date-only
- **THEN** burn's `why` list has "Burn 640 kcal, above your usual 430. You logged a workout."

#### Scenario: Sauna yesterday beside resting heart rate
- **WHEN** resting heart rate fires and a timed sauna session ended in the day or night before
- **THEN** its `why` list has "You logged sauna yesterday. Its effect on resting heart rate is not settled."

#### Scenario: Date-only sauna
- **WHEN** HRV fires and the only sauna logged the day before is date-only
- **THEN** no sauna line is shown

#### Scenario: Two candidates
- **WHEN** HRV fires low and both evening alcohol and a late workout were logged the evening before
- **THEN** both lines are shown

#### Scenario: No matching candidate
- **WHEN** sleep fires, or HRV fires with only `late_caffeine` logged the evening before
- **THEN** no tier-one line is shown for that signal

#### Scenario: Short or flat baseline
- **WHEN** a signal has 10 baseline days, or every baseline day has the same value
- **THEN** no line is shown for it

### Requirement: Tier-two patterns
Tier two SHALL cover these pairs: each item is a logged session category (`strength`, `cardio`, `sauna`, `cold_plunge`) or a habit key (`evening_alcohol`, `late_caffeine`), and each signal is HRV, resting heart rate or sleep. The late workout SHALL NOT be a tier-two item, because it needs a time. A day with the item logged SHALL map to the night that starts on that day, so a date-only session counts for its day with no time rule. For each pair, once there are at least 5 logged days and 5 days without a log in the last 90, each with the signal present on the following night, the system SHALL compare the signal's average on nights after logged days with its average on nights after days without a log.

The line SHALL appear beside the signal for a night when the item was logged on the day that night starts, and SHALL replace only the tier-one line for the same item and signal; it SHALL never suppress another line, such as the late-workout line. Its wording SHALL be "Nights after a logged <item>: <signal> averaged <percent>% <higher | lower> than nights without one logged (<logged> vs <without> nights). Small sample; days you log may differ from days you don't in other ways." A difference under 10 percent SHALL read "Nights after a logged <item>: no clear difference yet in <signal> (<logged> vs <without> nights). Small sample; days you log may differ from days you don't in other ways." The comparison SHALL be worded as logged against without a log, never as did against did not. No significance test SHALL be applied, and the line SHALL never say "because".

#### Scenario: Enough days
- **WHEN** sauna was logged on 8 of the last 90 days and HRV averaged 12 percent higher on the following nights than on 21 nights without one logged
- **THEN** the night after a logged sauna shows "Nights after a logged sauna: HRV averaged 12% higher than nights without one logged (8 vs 21 nights). Small sample; days you log may differ from days you don't in other ways."

#### Scenario: Small difference
- **WHEN** the difference is 4 percent with 8 and 21 nights
- **THEN** the line reads "Nights after a logged sauna: no clear difference yet in HRV (8 vs 21 nights). Small sample; days you log may differ from days you don't in other ways."

#### Scenario: Date-only session counts for its day
- **WHEN** strength is logged only as date-only sessions on 6 days
- **THEN** those 6 days count as logged days for strength against the nights that start on them

#### Scenario: Too few days
- **WHEN** sauna was logged on 4 days
- **THEN** no tier-two line is shown for sauna and the tier-one wording stays

### Requirement: Body fat trend
The system SHALL store and show every scale body fat reading through a body fat history read. A day's trend reading SHALL be that day's first weigh-in that has a body fat value. A reading within 12 hours after the end of a timed merged workout or sauna session SHALL be shown marked "after a workout" and left out of the trend, and a day whose first such reading is marked SHALL have no trend reading; a date-only session SHALL never exclude a reading. The current level SHALL be the median of the trend readings in the last 28 days, and the trend SHALL be the change from the median of the 28 days before them. Each window SHALL need at least 8 trend readings; with fewer, the card SHALL show the readings and the lines "Not enough readings for a trend" and "<count> of 8 readings in the last 4 weeks" (or "in the 4 weeks before" when only the earlier window is short). The change SHALL be rounded to one decimal place, and a rounded change under 2 points SHALL be described as within the scale's error in the body fat sentence below, which SHALL carry the tooltip "This scale's error is about 2 points".

The system SHALL never call a body fat change fat or muscle on the reading alone; it SHALL state it beside the training log and weight trend as three lines, in this order, under the current level shown as "<level>%". The training sentence SHALL be "No strength sessions logged in 3 weeks.", "1 strength session logged in 3 weeks." or "<N> strength sessions logged in 3 weeks.". The weight sentence SHALL give the weight trend's change over the same 28 days as the body fat level rounded to one decimal place, as "Weight up <change> kg.", "Weight down <change> kg." or, when the rounded change is zero, "Weight unchanged.". The body fat sentence SHALL be "Body fat reading <up | down> <change> points, within this scale's error." for a change under 2 points, "Body fat reading <up | down> <change> points." for 2 points or more, and "Body fat reading unchanged, within this scale's error." when the rounded change is zero, with "point" in place of "points" for a change of exactly 1. The three lines SHALL NOT be shown when the body fat trend has too few readings.

#### Scenario: Post-workout reading
- **WHEN** the day's first weigh-in with body fat comes 3 hours after a timed workout ended
- **THEN** it is shown marked "after a workout" and that day has no trend reading

#### Scenario: Date-only session
- **WHEN** a weigh-in falls on the morning after a date-only session
- **THEN** it stays in the trend

#### Scenario: Too few readings
- **WHEN** a window has 6 trend readings
- **THEN** the card shows the readings, shows "Not enough readings for a trend" and "6 of 8 readings in the last 4 weeks", and no training, weight or body fat line

#### Scenario: Cutoff on the rounded change
- **WHEN** the level moves 1.96 points down from the prior window, which rounds to 2.0
- **THEN** the body fat line reads "Body fat reading down 2 points." with no within-error wording

#### Scenario: Small change
- **WHEN** the level moves 1.2 points down from the prior window
- **THEN** the body fat line reads "Body fat reading down 1.2 points, within this scale's error." with the tooltip "This scale's error is about 2 points"

#### Scenario: Three lines with no strength sessions
- **WHEN** no strength sessions are logged in 3 weeks, the weight trend fell 1.2 kg over the level's 28 days and the body fat level is up 1 point
- **THEN** the card shows the lines "No strength sessions logged in 3 weeks.", "Weight down 1.2 kg." and "Body fat reading up 1 point, within this scale's error."

#### Scenario: Three lines with a real change
- **WHEN** 9 strength sessions are logged in 3 weeks, the weight trend fell 0.4 kg and the body fat level is up 2.4 points
- **THEN** the card shows the lines "9 strength sessions logged in 3 weeks.", "Weight down 0.4 kg." and "Body fat reading up 2.4 points."

#### Scenario: One session and no change
- **WHEN** 1 strength session is logged in 3 weeks, the weight trend is unchanged and the body fat level is unchanged
- **THEN** the card shows the lines "1 strength session logged in 3 weeks.", "Weight unchanged." and "Body fat reading unchanged, within this scale's error."

#### Scenario: Weight change rounds to zero
- **WHEN** the weight trend changes 0.04 kg over the level's 28 days
- **THEN** the weight line reads "Weight unchanged."

#### Scenario: No body fat readings
- **WHEN** a person's scale never reports body fat
- **THEN** the card shows no body fat trend
