## ADDED Requirements

### Requirement: Day templates and slots
Each person SHALL define day templates made of slots, each with a name, a time window, a share of the day's calories and protein, and an optional fill hint, and day types that choose a template.

#### Scenario: Pick a day type
- **WHEN** a person sets today's day type
- **THEN** today's slots come from that type's template

### Requirement: Calendar day-type rule
A person SHALL be able to choose day types by a keyword in a calendar feed. The engine SHALL fetch only the configured HTTPS URL, reject private network targets, cache the result, and fall back to the manual day type when the feed is unavailable.

#### Scenario: Feed unreachable
- **WHEN** the calendar feed cannot be fetched
- **THEN** today uses the manual or default day type and logging is unaffected

### Requirement: Slot budgets
Each slot SHALL have a budget from today's target and its share. Unused budget SHALL roll into later slots. A next-slot operation and sensor SHALL report the coming slot and its remaining budget.

#### Scenario: Light lunch
- **WHEN** a person eats less than the lunch budget
- **THEN** the remainder is added to the later slots

### Requirement: Planned items
Agents SHALL be able to place planned items in a slot. One shared meal action (ate, ate 3/4, skip) SHALL act on a specific item by id and revision, log intake and update stock in one transaction, and be idempotent by mutation id.

#### Scenario: Agent plans dinner
- **WHEN** an agent places an on-hand meal in the dinner slot
- **THEN** the app and Home Assistant show it as dinner's planned item

#### Scenario: Retry of a meal action
- **WHEN** the same meal action is retried with the same mutation id
- **THEN** intake and stock change once

### Requirement: Slot view
The app SHALL show today's slots with their budgets and planned items and offer the meal actions.

#### Scenario: Open today's plan
- **WHEN** a person opens the plan view
- **THEN** each slot shows its remaining budget and planned item

### Requirement: Suggested slot budgets
The system SHALL suggest slot shares from a person's slot-labelled history and let them accept or ignore the suggestion.

#### Scenario: Enough history
- **WHEN** a person has enough slot-labelled days
- **THEN** the system offers slot shares based on what they actually ate per slot
