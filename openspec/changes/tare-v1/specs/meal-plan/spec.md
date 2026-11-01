## ADDED Requirements

### Requirement: Day templates and slots
Each person SHALL define day templates made of slots, each with a name, a time window, a share of the day's calories and protein, and an optional fill hint, and day types that choose a template.

#### Scenario: Pick a day type
- **WHEN** a person sets today's day type
- **THEN** today's slots come from that type's template

### Requirement: Calendar day-type rule
A person SHALL be able to choose day types by a keyword in their own calendar feed. The feed URL SHALL be HTTPS, SHALL be treated as a secret (never logged, never shown to another person), and SHALL be fetched only when every address its host resolves to is public: loopback, private, link-local, unique-local, carrier-grade NAT, multicast and unspecified addresses, and IPv4-mapped forms of them, SHALL be rejected. The engine SHALL connect to the address it checked, follow no redirects, stop after 10 seconds or 1 MB, cache the result for an hour, and fall back to the manual day type when the feed is unavailable. Calendars on the local network are therefore not supported.

#### Scenario: Feed unreachable
- **WHEN** the calendar feed cannot be fetched
- **THEN** today uses the manual or default day type and logging is unaffected

#### Scenario: Host resolves to a private address
- **WHEN** a feed's public-looking host name resolves to a private address
- **THEN** nothing is fetched and the manual day type is used

#### Scenario: Redirect
- **WHEN** the feed answers with a redirect
- **THEN** the redirect is not followed and the feed counts as unavailable

### Requirement: Slot budgets
Each slot SHALL have a budget of today's target times its share. An intake entry SHALL belong to the slot a planned-item action names; otherwise to the slot whose time window contains its eaten-at time; otherwise to the next slot that day, or the last slot when none is later. When a slot's window ends, its unused budget, or its overspend as a negative amount, SHALL be spread over the later slots in proportion to their shares, and no budget SHALL go below zero. The day's total budget is therefore conserved except when an overspend is larger than what the later slots have left. A next-slot operation SHALL report the coming slot and its remaining budget.

#### Scenario: Light lunch
- **WHEN** a person with a 2,000 kcal target and shares of 20, 30, 10 and 40 percent for breakfast, lunch, snack and dinner eats 400 kcal at breakfast and 300 kcal at lunch
- **THEN** the 300 kcal left from lunch is spread as 60 kcal to the snack and 240 kcal to dinner, giving budgets of 260 kcal and 1,040 kcal

### Requirement: Planned items
Agents SHALL be able to place planned items, each an on-hand meal or a food with a revision, in a slot. The shared meal action SHALL act on one planned item by id and revision: "ate it" logs the item's nutrition once and "ate 3/4" logs three quarters of it, both taking one from the linked on-hand meal in the same transaction; "skip" logs nothing, changes no stock and marks the item skipped. A stale revision SHALL be rejected, and the action SHALL be idempotent by a per-person mutation id.

#### Scenario: Agent plans dinner
- **WHEN** an agent places an on-hand meal in the dinner slot
- **THEN** the app and Home Assistant show it as dinner's planned item

#### Scenario: Skip
- **WHEN** a person skips a planned on-hand meal
- **THEN** no intake is logged, the meal's quantity is unchanged and the item shows as skipped

#### Scenario: Ate three quarters of a planned meal
- **WHEN** a person marks a planned 800 kcal on-hand meal as "ate 3/4"
- **THEN** a 600 kcal entry is logged in that slot and the meal's quantity drops by one

#### Scenario: Retry of a meal action
- **WHEN** the same meal action is retried with the same mutation id
- **THEN** intake and stock change once

### Requirement: Slot view
The app SHALL show today's slots with their budgets and planned items and offer the meal actions.

#### Scenario: Open today's plan
- **WHEN** a person opens the plan view
- **THEN** each slot shows its remaining budget and planned item

### Requirement: Suggested slot budgets
Once a person has at least 14 signed-off days of slot-assigned intake, the system SHALL suggest each slot's share as that slot's average share of those days' intake, and the slot view SHALL let the person accept or ignore the suggestion.

#### Scenario: Enough history
- **WHEN** a person has 14 or more signed-off days of slot-assigned intake
- **THEN** the slot view offers shares based on what they actually ate per slot
