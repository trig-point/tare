## ADDED Requirements

### Requirement: Activity adjustment to the day's target
The day's calorie target SHALL be the weekly target from the one target reader plus an activity adjustment from one tracker source's active calories, rounded as the formula target is. The adjustment SHALL be the larger of zero and today's active calories so far minus that source's 28-day average daily active calories, limited to a cap (default 500 kcal, configuration). It SHALL never be negative, and the day's base SHALL be the weekly target with no offset; the resulting upward drift in the week's average target is accepted. The adjustment SHALL be zero when the source has no reading today, or when it has readings on fewer than 14 days of the 28-day window. One source per person SHALL feed the adjustment, the first eligible one in a fixed order matching the client's (manual, Oura, agent); sources SHALL never be summed. The stored weekly target and the TDEE estimate SHALL NOT change. Today's target, the slot budgets and the Home Assistant target sensors SHALL read the adjusted target through the one target reader, whose response SHALL carry the base, the adjustment, the source and whether it was capped, or the reason it is zero. The target card SHALL show the base and the addition. The weekly target notice SHALL keep comparing weekly targets.

#### Scenario: Training day
- **WHEN** a person's weekly target is 2,180 kcal, their source's 28-day average is 430 kcal, and it shows 680 kcal of active burn so far today
- **THEN** today's target is 2,430 kcal and the card shows "Base 2,180. +250 from activity."

#### Scenario: Morning
- **WHEN** the source shows 120 kcal so far against a 28-day average of 430 kcal
- **THEN** the adjustment is zero and today's target is the weekly target

#### Scenario: Capped
- **WHEN** today's burn so far is 1,200 kcal above the 28-day average
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
