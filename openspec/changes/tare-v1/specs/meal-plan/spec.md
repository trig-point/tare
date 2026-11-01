## ADDED Requirements

### Requirement: Day templates and slots
Each person SHALL define, through operations, day templates made of slots and day types that choose a template. Each slot SHALL have a name, a time window, a share of the day's calories and protein, and an optional fill hint: free text for agents placing items (such as "high protein" or "leftovers"). A template SHALL be rejected unless its shares sum to 100 percent and its windows do not overlap.

#### Scenario: Pick a day type
- **WHEN** a person sets today's day type
- **THEN** today's slots come from that type's template

#### Scenario: Shares do not add up
- **WHEN** a template's shares sum to 80 percent
- **THEN** it is rejected with a stable error code

### Requirement: Calendar day-type rule
A person SHALL be able to choose day types by a keyword in their own calendar feed. The feed URL SHALL be HTTPS, SHALL be treated as a secret (never logged, never shown to another person), and SHALL be fetched only when every address its host resolves to is public: loopback, private, link-local, unique-local, carrier-grade NAT, multicast and unspecified addresses, and IPv4-mapped forms of them, SHALL be rejected. The engine SHALL connect to the address it checked while verifying TLS for the original host name, follow no redirects, stop after 10 seconds or 1 MB, cache the result for an hour, and fall back to the manual day type when the feed is unavailable. Calendars on the local network are therefore not supported.

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
Each slot SHALL have a budget of today's target times its share. Each intake entry's slot SHALL be stored when the entry is written: the slot a planned-item action names, otherwise the slot whose time window contains its eaten-at time, otherwise the next slot that day, or the last slot when none is later. When a slot's window ends, its unused budget (its current budget, including anything it received, minus its intake), or its overspend as a negative amount, SHALL be spread over the later slots in proportion to their shares, and the ended slot's budget becomes its intake. No budget SHALL go below zero, so the day's total budget is conserved except when an overspend is larger than what the later slots have left. A next-slot operation SHALL report the coming slot and its remaining budget.

#### Scenario: Light lunch
- **WHEN** a person with a 2,000 kcal target and shares of 20, 30, 10 and 40 percent for breakfast, lunch, snack and dinner eats 400 kcal at breakfast and 300 kcal at lunch
- **THEN** lunch's budget becomes 300 kcal and its 300 kcal left over is spread as 60 kcal to the snack and 240 kcal to dinner, giving budgets of 260 kcal and 1,040 kcal, a total of 2,000 kcal

### Requirement: Planned items
Agents SHALL be able to place planned items, each an on-hand meal or a food with a revision, in a slot. The shared meal action SHALL act on one planned item by id, revision and per-person mutation id, looking up the mutation id before checking the revision so a retry returns the first result. "Ate it" logs the item's nutrition once and "ate 3/4" logs three quarters of it, into the item's slot; for an on-hand meal both take one from it in the same transaction, and a food item changes no stock. "Skip" logs nothing, changes no stock and marks the item skipped. Every accepted action SHALL mark the item eaten or skipped and advance its revision, so a second action with a new mutation id is stale. A stale revision SHALL be rejected.

#### Scenario: Agent plans dinner
- **WHEN** an agent places an on-hand meal in the dinner slot
- **THEN** reading today's plan returns it as dinner's planned item

#### Scenario: Skip
- **WHEN** a person skips a planned on-hand meal
- **THEN** no intake is logged, the meal's quantity is unchanged and the item shows as skipped

#### Scenario: Ate three quarters of a planned meal
- **WHEN** a person marks a planned 800 kcal on-hand meal as "ate 3/4"
- **THEN** a 600 kcal entry is logged in that slot and the meal's quantity drops by one

#### Scenario: Planned food
- **WHEN** a person marks a planned food (not an on-hand meal) as eaten
- **THEN** its nutrition is logged in that slot and no stock changes

#### Scenario: Retry of a meal action
- **WHEN** the same meal action is retried with the same mutation id
- **THEN** intake and stock change once

#### Scenario: Second action on an eaten item
- **WHEN** an action with a new mutation id arrives for a planned item that is already eaten
- **THEN** it is rejected as stale and nothing is logged

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
