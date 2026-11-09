## ADDED Requirements

### Requirement: Activity bonus on the day's target
The day's calorie target SHALL be the target from the one target reader (the base, B) plus an activity bonus. The bonus SHALL be the larger of zero and the credited day's active calories from the selected tracker source minus that source's 28-day average, limited to a cap (default 500 kcal, configuration), then rounded once to whole kcal before it is added, so the total is an integer. There SHALL be no offset: a day without a bonus gets B. Only sources on a fixed engine-side list of eligible trackers (`oura` to start) SHALL drive the bonus; `manual` and `agent` active calories SHALL never drive it. With several eligible trackers, one SHALL be selected per person in a fixed order and both the credited value and the average SHALL come from it; trackers SHALL never be summed.

The 28-day average SHALL be the mean of the selected source's active calories over the 28 days before the credited day, not including it, counting only days with a reading, and the bonus SHALL require readings on at least 14 of those days. Values SHALL be read when the target is read.

The credit mode SHALL be configuration set from the intraday probe. In same-day mode the credited day SHALL be today, using its burn so far. In next-day mode the credited day SHALL be yesterday, once its burn has synced, and the bonus SHALL apply to today. The bonus for Tare day D SHALL read the tracker's record for day D as the sync stores it, even when the tracker's day boundary differs from the person's day-start hour.

The weekly estimate, the stored weekly target and the weekly target notice SHALL NOT change. The bonus SHALL apply the same way when B is a formula target. The reader's result SHALL carry the base, its basis, the bonus (status, kcal, source, mode, capped) and the total; `kcal` SHALL be the total, so remaining kcal and slot budgets read it with no second calculation, and slots that have ended keep their budgets. The week's targets SHALL run above B on average by the bonuses, with no automatic correction.

The target card SHALL show the base and the bonus with the burn value and the last sync time. The Today page SHALL refetch the today, plan and signals queries together on window focus and every 15 minutes, and logging writes SHALL refresh the same set.

#### Scenario: Training day
- **WHEN** in same-day mode B is 2,180 kcal, the source's 28-day average is 430 kcal and today shows 680 kcal so far
- **THEN** today's target is 2,430 kcal and the card shows "Base 2,180. +250 from activity."

#### Scenario: Quiet day
- **WHEN** today's burn so far is 120 kcal against an average of 430 kcal
- **THEN** the bonus is zero and the target is B

#### Scenario: Next-day mode
- **WHEN** in next-day mode yesterday's full burn of 680 kcal has synced against an average of 430 kcal over the 28 days before yesterday
- **THEN** today's target is B plus 250 and the card shows "+250 from yesterday's activity."

#### Scenario: Awaiting data
- **WHEN** an eligible source exists but has no reading for the credited day yet
- **THEN** the target is B and the card says "Activity: waiting for today's data."

#### Scenario: No usable source
- **WHEN** there is no eligible tracker, or it has readings on 9 of the 28 days
- **THEN** the target is B and the card says "Activity bonus after 14 days of tracker data."

#### Scenario: Capped
- **WHEN** the credited burn is 1,200 kcal above the average
- **THEN** the bonus is 500 kcal and the card shows "+500 from activity (capped)"

#### Scenario: Fractional average
- **WHEN** the average is 430.6 kcal and today shows 680 kcal
- **THEN** the bonus is a whole number of kcal and every slot budget stays an integer

#### Scenario: Hand-entered burn
- **WHEN** a `manual` or `agent` active-calories entry exists beside the tracker's reading
- **THEN** only the tracker's reading drives the bonus, and with only hand-entered burn there is no bonus

#### Scenario: Open page refreshes
- **WHEN** the stored Oura data changes with no browser write or focus event
- **THEN** the target card and the Body card both show the new values at the next 15-minute refetch

#### Scenario: Weekly estimate unaffected
- **WHEN** the weekly recompute runs after a week of bonuses
- **THEN** the estimate, the stored weekly target and the weekly target notice are the same as they would be with no bonus
