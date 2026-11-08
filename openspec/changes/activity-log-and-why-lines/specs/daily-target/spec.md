## ADDED Requirements

### Requirement: Activity adjustment to today's target
Today's calorie target SHALL be the target from the one target reader plus an activity adjustment, rounded as the formula target is. The adjustment SHALL be today's cumulative active calories so far minus the person's usual active calories by the same local time of day, both from the same source, limited to 500 kcal in either direction. The usual burn SHALL be the mean, over the previous 28 days that have burn samples from that source, of the cumulative burn at the same local time of day, interpolated between the samples on each side. The adjustment SHALL be zero when there is no sample today or when the source has samples on fewer than 14 of the previous 28 days. When a person has several sources, the adjustment SHALL use the one with the most sample days in the previous 28 days, ties broken by source name, and SHALL never sum sources. The stored weekly target and the TDEE estimate SHALL NOT change. Today's target, the slot budgets and the Home Assistant target sensors SHALL read the adjusted target through the one target reader, and the response SHALL carry the base, the adjustment, the source and the reason when the adjustment is zero. The cap, the 14-day minimum and the 28-day length SHALL be configuration with these defaults. OPEN: operator choice. The same-time-of-day rule is the recommended way to keep the adjustment from drifting; the alternative compares against the full-day mean, clips the adjustment at zero and lowers each day's base by the mean adjustment of the previous 28 days.

#### Scenario: Training day
- **WHEN** a person's stored target is 2,400 kcal, their source shows 650 kcal of active burn by 6:00 PM, and their usual burn by 6:00 PM over the previous 28 days is 400 kcal
- **THEN** today's target is 2,650 kcal and the card shows "+250 from activity"

#### Scenario: Quiet day
- **WHEN** the same person shows 250 kcal by 6:00 PM against a usual 400 kcal
- **THEN** today's target is 2,250 kcal and the card shows "-150 from activity"

#### Scenario: Capped
- **WHEN** today's burn so far is 1,200 kcal above the usual burn by the same time
- **THEN** the adjustment is 500 kcal

#### Scenario: No data today
- **WHEN** there is no burn sample today
- **THEN** the adjustment is zero and the card says no activity data has arrived today

#### Scenario: New source
- **WHEN** the only source has samples on 9 of the previous 28 days
- **THEN** the adjustment is zero and the card says the source needs 14 days

#### Scenario: Two sources
- **WHEN** a person has 25 sample days from one source and 12 from another
- **THEN** the adjustment uses only the first source and the two are never added

#### Scenario: Weekly estimate unaffected
- **WHEN** the weekly recompute runs after a week of adjusted days
- **THEN** the estimate and stored target are the same as they would be with no adjustment
