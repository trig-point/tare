## ADDED Requirements

### Requirement: Activity adjustment to the day's target
The day's calorie target SHALL be the weekly target from the one target reader plus an activity adjustment from one tracker source's active calories, rounded as the formula target is. The adjustment SHALL be the larger of zero and the input day's active calories minus that source's own 28-day average daily active calories, limited to a cap (default 500 kcal, configuration). It SHALL never be negative, and the day's base SHALL be the weekly target with no offset; the resulting upward drift in the week's average target is accepted. The input day SHALL be set by one setting chosen from the intraday probe: on the same-day path it SHALL be today, using the burn so far; on the next-day path it SHALL be yesterday, once yesterday's full burn has synced, and the card SHALL say the addition is from yesterday's activity. The adjustment SHALL be zero when the source has no reading for the input day, or when it has readings on fewer than 14 days of the 28-day window. One tracker source per person SHALL feed the adjustment, the first eligible one in a fixed tracker order; active calories logged by hand (manual or agent) SHALL be shown and used in why-lines but SHALL never drive the adjustment; sources SHALL never be summed. The stored weekly target and the TDEE estimate SHALL NOT change. Today's target, the slot budgets and the Home Assistant target sensors SHALL read the adjusted target through the one target reader, whose response SHALL carry the base, the adjustment, the source and whether it was capped, or the reason it is zero. The target card SHALL show the base and the addition. The weekly target notice SHALL keep comparing weekly targets.

#### Scenario: Training day
- **WHEN** a person's weekly target is 2,180 kcal, their source's 28-day average is 430 kcal, and it shows 680 kcal of active burn so far today
- **THEN** today's target is 2,430 kcal and the card shows "Base 2,180. +250 from activity."

#### Scenario: Morning
- **WHEN** on the same-day path the source shows 120 kcal so far against a 28-day average of 430 kcal
- **THEN** the adjustment is zero and today's target is the weekly target

#### Scenario: Next-day path
- **WHEN** on the next-day path yesterday's full Oura burn of 680 kcal has synced against a 28-day average of 430 kcal and the weekly target is 2,180 kcal
- **THEN** today's target is 2,430 kcal and the card shows "Base 2,180. +250 from yesterday's activity."

#### Scenario: Next-day path before yesterday syncs
- **WHEN** on the next-day path yesterday's burn has not synced
- **THEN** the target is the weekly target and the card says "No activity data yet."

#### Scenario: Capped
- **WHEN** today's burn so far is 1,200 kcal above the 28-day average
- **THEN** the adjustment is 500 kcal and the card shows "+500 from activity (capped)"

#### Scenario: No data today
- **WHEN** the source has no reading for the input day
- **THEN** the target is the weekly target and the card says "No activity data yet."

#### Scenario: New source
- **WHEN** the only source has readings on 9 days of the 28-day window
- **THEN** the target is the weekly target and the card says "Activity adjustment after 14 days of data."

#### Scenario: Hand-logged burn
- **WHEN** a person has eligible Oura active calories and a manual or agent active-calories entry for the same day
- **THEN** the adjustment uses only Oura, the hand-logged burn is shown, and the two are never added

#### Scenario: Only hand-logged burn
- **WHEN** a person has active calories only from manual or agent entries
- **THEN** there is no adjustment and the target is the weekly target

#### Scenario: Weekly estimate unaffected
- **WHEN** the weekly recompute runs after a week of adjusted days
- **THEN** the estimate, the stored weekly target and the weekly target notice are the same as they would be with no adjustment
