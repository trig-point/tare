## ADDED Requirements

### Requirement: Tier-one why-lines
For each signal on a day, the system SHALL compare it with its baseline: the 28 days before that day, excluding the day itself. No line SHALL be shown with fewer than 14 baseline days or when the baseline's standard deviation is zero. A signal SHALL fire when it is more than 1 standard deviation from the baseline mean and, for HRV, also at least 10 percent from it. When a signal fires, the Body card SHALL show every candidate from a fixed list that matches, each in its fixed template, worded as co-occurrence and never with "because". The candidates SHALL be: a workout on a day whose active burn fired high; a workout ending within 4 hours of the start of the main sleep (the night's longest sleep period) beside low HRV or high resting heart rate; alcohol logged on the evening before beside low HRV; and sauna logged the day before beside any HRV change, shown as "You logged sauna yesterday. Its effect on HRV is not settled." Notes on day D SHALL attach to the night that starts on D. General-finding sentences SHALL carry no numbers until their figures are checked against promoted research. The thresholds SHALL be configuration with these defaults.

#### Scenario: Late workout and low HRV
- **WHEN** a person's HRV is 1.5 standard deviations and 15 percent below baseline and a workout ended 2 hours before the main sleep began
- **THEN** the card shows the late-workout line beside HRV, without the word "because"

#### Scenario: Sauna yesterday
- **WHEN** HRV fires and sauna was logged the day before
- **THEN** the card shows "You logged sauna yesterday. Its effect on HRV is not settled."

#### Scenario: Two candidates
- **WHEN** HRV fires low and both alcohol and a late workout were logged the evening before
- **THEN** both lines are shown

#### Scenario: Short baseline
- **WHEN** a signal has 10 baseline days
- **THEN** no line is shown for it

#### Scenario: Flat baseline
- **WHEN** every baseline day has the same value
- **THEN** no line is shown for it

### Requirement: Tier-two patterns
For each habit key and session kind, the system SHALL compare the next-night HRV and resting heart rate on days with that item logged against days with no log of it, over the last 90 days, once each side has at least 5 days. The line SHALL name both averages and both day counts and SHALL word the comparison as logged against not logged, never as yes against no. No significance test SHALL be applied.

#### Scenario: Enough days
- **WHEN** sauna was logged on 8 of the last 90 days and 21 days with HRV have no sauna logged
- **THEN** the card shows both averages with "8 and 21 days"

#### Scenario: Too few days
- **WHEN** sauna was logged on 4 days
- **THEN** no tier-two line is shown for sauna

### Requirement: Body fat trend
The system SHALL show scale body fat as a trend of the day's first weigh-in only, dropping any reading taken within 12 hours after the end of a merged workout or a sauna session, as a 28-day rolling median. The trend SHALL always be shown with an error band of 2 points. A change SHALL be named only when the median moves 2 or more points over at least 4 weeks. The card SHALL never describe a change as fat or muscle.

#### Scenario: Post-workout reading dropped
- **WHEN** the day's first weigh-in comes 3 hours after a workout ended
- **THEN** that reading is left out of the trend

#### Scenario: Small change
- **WHEN** the median moves 1.2 points over 6 weeks
- **THEN** the card shows the trend and its band but names no change

#### Scenario: Real change
- **WHEN** the median moves 2.4 points down over 5 weeks
- **THEN** the card names a 2.4-point fall and does not call it fat loss

#### Scenario: No body fat readings
- **WHEN** a person's scale never reports body fat
- **THEN** the card shows no body fat trend
