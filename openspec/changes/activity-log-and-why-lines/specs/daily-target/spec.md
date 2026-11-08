## ADDED Requirements

### Requirement: Activity adjustment to the day's target
The day's calorie target SHALL be a base plus an activity adjustment from one tracker source's active calories, rounded as the formula target is. The adjustment SHALL be limited to a cap (default 500 kcal, configuration). The adjustment and any offset SHALL be zero when the source has no reading today, or when it has readings on fewer than 14 days of the 28-day window. One source per person SHALL feed the adjustment, the first eligible one in a fixed order matching the client's (manual, Oura, agent); sources SHALL never be summed. The stored weekly target and the TDEE estimate SHALL NOT change. Today's target, the slot budgets and the Home Assistant target sensors SHALL read the adjusted target through the one target reader, whose response SHALL carry the weekly target, the base, the adjustment, the source and whether it was capped, or the reason it is zero. The weekly target notice SHALL keep comparing weekly targets.

OPEN: operator choice. The recommended rule is same time of day: the base SHALL be the weekly target, and the adjustment SHALL be today's cumulative burn so far minus the mean, over the previous 28 days with burn samples from that source, of the cumulative burn at the same local time of day, interpolated between samples, in either direction; each sync SHALL store a burn sample of today's cumulative active calories, upserted by person, source and observed minute. The alternative is the base offset: the adjustment SHALL be the larger of zero and today's burn so far minus the source's 28-day average daily burn, and the base SHALL be the weekly target minus the 28-day average of each past day's final capped adjustment. Either rule keeps the day's targets averaging to the weekly target.

#### Scenario: Training day
- **WHEN** a person's weekly target is 2,400 kcal, their source shows 680 kcal of active burn so far, and their usual burn by this time is 430 kcal
- **THEN** today's target is 2,650 kcal and the card shows "+250 from activity"

#### Scenario: Capped
- **WHEN** today's burn so far is 1,200 kcal above the usual burn
- **THEN** the adjustment is 500 kcal and the card shows "+500 from activity (capped)"

#### Scenario: No data today
- **WHEN** the source has no reading today
- **THEN** the target is the weekly target and the card says "No activity data yet."

#### Scenario: New source
- **WHEN** the only source has readings on 9 days of the 28-day window
- **THEN** the target is the weekly target and the card says "Activity adjustment after 14 days of data."

#### Scenario: Two sources
- **WHEN** a person has eligible manual and Oura active calories
- **THEN** the adjustment uses only the manual source and the two are never added

#### Scenario: Weekly estimate unaffected
- **WHEN** the weekly recompute runs after a week of adjusted days
- **THEN** the estimate, the stored weekly target and the weekly target notice are the same as they would be with no adjustment
