## ADDED Requirements

### Requirement: Activity bonus on the day's target
The day's calorie target SHALL be the target from the one target reader (the base, B) plus an activity bonus. The bonus SHALL be the larger of zero and the credited day's active calories from the selected tracker source minus that source's 28-day average, limited to a cap (default 500 kcal, configuration), then rounded once to whole kcal before it is added, so the total is an integer. There SHALL be no offset: a day without a bonus gets B. Only sources on a fixed engine-side list of eligible trackers (`oura` to start) SHALL drive the bonus; `manual` and `agent` active calories SHALL never drive it. With several eligible trackers, one SHALL be selected per person in a fixed order and both the credited value and the average SHALL come from it; trackers SHALL never be summed.

The 28-day average SHALL be the mean of the selected source's active calories over the 28 days before the credited day, not including it, counting only days with a reading, and the bonus SHALL require readings on at least 14 of those days. Values SHALL be read when the target is read.

The credit mode SHALL be the setting `TARE_ACTIVITY_CREDIT`, `same-day` or `next-day`, trimmed and case-insensitive, with empty counting as unset. Its default SHALL be `same-day`, because the intraday probe found that Oura's record for today updates during the day; `next-day` SHALL remain available for a tracker without intraday updates. Any other value SHALL stop startup. In same-day mode the credited day SHALL be today, using its burn so far. In next-day mode the credited day SHALL be yesterday, and the bonus SHALL apply to today once a stored reading exists for yesterday. The credited day C SHALL read the tracker's record whose day is C, as the sync stores it, even when the tracker's day boundary differs from the person's day-start hour.

When the source is not usable (no eligible tracker, or fewer than 14 days with a reading), the card SHALL say "Activity bonus after 14 days of tracker data.", and this message SHALL win over the awaiting message. When a usable source has no reading for the credited day yet, the card SHALL say "Activity: waiting for today's data." in same-day mode and "Activity: waiting for yesterday's data." in next-day mode. A capped bonus SHALL read "+500 from activity (capped)" in same-day mode and "+500 from yesterday's activity (capped)" in next-day mode.

The weekly estimate, the stored weekly target and the weekly target notice SHALL NOT change. The bonus SHALL apply the same way when B is a formula target. The reader's result SHALL carry the base, its basis, the bonus and the total. The bonus SHALL carry its status, kcal, source, mode, whether it was capped, the credited day, the credited burn, the 28-day average and the source's last sync time. The reader result's top-level `kcal` SHALL be the total, so remaining kcal and slot budgets read it with no second calculation, and slots that have ended keep their budgets. The week's targets SHALL run above B on average by the bonuses, with no automatic correction.

The target card SHALL show the base and the bonus with the source, the credited burn and the last sync time. When the reader returns `needs_profile` or `needs_weigh_in`, there SHALL be no base, no bonus and no total, and the card SHALL show the existing no-target state. The Today page SHALL refetch the today, plan and signals queries together on window focus and every 15 minutes, and logging writes SHALL refresh the same set.

#### Scenario: Training day
- **WHEN** in same-day mode B is 2,180 kcal, the source's 28-day average is 430 kcal and today shows 680 kcal so far
- **THEN** today's target is 2,430 kcal, the card shows "Base 2,180. +250 from activity." and the bonus carries today as the credited day, 680 kcal, 430 kcal and the last sync time

#### Scenario: Quiet day
- **WHEN** today's burn so far is 120 kcal against an average of 430 kcal
- **THEN** the bonus is zero and the target is B

#### Scenario: Next-day mode
- **WHEN** in next-day mode a stored reading of 680 kcal exists for yesterday against an average of 430 kcal over the 28 days before yesterday
- **THEN** today's target is B plus 250 and the card shows "+250 from yesterday's activity."

#### Scenario: Next-day mode before yesterday syncs
- **WHEN** in next-day mode a usable source has no stored reading for yesterday
- **THEN** the target is B and the card says "Activity: waiting for yesterday's data."

#### Scenario: Awaiting data in same-day mode
- **WHEN** in same-day mode a usable source has no reading for today yet
- **THEN** the target is B and the card says "Activity: waiting for today's data."

#### Scenario: No usable source wins
- **WHEN** the only eligible tracker has readings on 9 of the 28 days and none for the credited day
- **THEN** the target is B and the card says "Activity bonus after 14 days of tracker data."

#### Scenario: Capped
- **WHEN** the credited burn is 1,200 kcal above the average
- **THEN** the bonus is 500 kcal and the card shows "+500 from activity (capped)" in same-day mode or "+500 from yesterday's activity (capped)" in next-day mode

#### Scenario: Fractional average
- **WHEN** the average is 430.6 kcal and today shows 680 kcal
- **THEN** the bonus is 249 kcal (249.4 rounded) and every slot budget stays an integer

#### Scenario: Hand-entered burn
- **WHEN** a `manual` or `agent` active-calories entry exists beside the tracker's reading
- **THEN** only the tracker's reading drives the bonus, and with only hand-entered burn there is no bonus

#### Scenario: Invalid credit mode
- **WHEN** the credit mode is set to a value other than `same-day` or `next-day`
- **THEN** startup stops with "TARE_ACTIVITY_CREDIT must be same-day or next-day"

#### Scenario: Open page refreshes
- **WHEN** the stored Oura data changes with no browser write or focus event
- **THEN** the target card and the Body card both show the new values at the next 15-minute refetch

#### Scenario: No target yet
- **WHEN** the reader returns `needs_profile` or `needs_weigh_in`
- **THEN** the result has no base, bonus or total and the card shows the existing no-target state

#### Scenario: Weekly estimate unaffected
- **WHEN** the weekly recompute runs after a week of bonuses
- **THEN** the estimate, the stored weekly target and the weekly target notice are the same as they would be with no bonus
