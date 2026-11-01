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
A person SHALL be able to choose day types by keywords in their own calendar feed: each keyword maps to one day type and is matched, ignoring case, as a whole word in the title (`SUMMARY`) of any event that overlaps the person's day, from their day start to the next, with recurring events expanded; when several match, the person's first-listed keyword wins. The feed URL SHALL be HTTPS and SHALL be treated as a secret (never logged, never shown to another person). The engine SHALL fetch it through request-filtering-agent, which checks the address each connection actually uses and refuses loopback, private, link-local, unique-local, carrier-grade NAT, multicast and unspecified addresses and their IPv4-mapped forms, so the address checked is the address used; a test SHALL cover each refused range. The engine SHALL verify TLS for the original host name, follow no redirects, stop after 10 seconds or 1 MB, cache the result for an hour, and fall back to the manual day type when the feed is unavailable. Calendars on the local network are therefore not supported.

#### Scenario: Keyword in an event title
- **WHEN** a person maps "office" to their office day type and today's feed has an event titled "Office day"
- **THEN** today uses the office day type

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
Slot budgets SHALL be computed from today's target, the slots' shares and the intake stored in each slot each time they are read, and never stored. Each intake entry's slot SHALL be stored when the entry is written: the slot a planned-item action names, otherwise the slot whose time window contains its eaten-at time, otherwise the next slot that day, or the last slot when none is later. An entry with no stored slot, or whose stored slot belongs to a template other than today's (it was logged before today's template existed, or the day type changed), SHALL be assigned on read by the same time-window rule, so no intake drops out of the budgets. A slot SHALL count as ended once its window has ended, except the day's last slot, which stays open until the person's day ends. A slot's intake SHALL be the sum of its entries' kcal, rounded once to the nearest whole kcal (halves up) before it is used; the entries keep their exact values. An ended slot's budget SHALL equal its intake. The open slots SHALL share the remaining day budget, which is today's target minus the ended slots' intake: each open slot's budget is the remaining day budget times its share, divided by the sum of the open slots' shares. When the remaining day budget is below zero, every open slot's budget SHALL be zero. Budgets SHALL be whole kcal: each open slot's budget is rounded down and the last open slot takes what is left, so the open slots' budgets add up exactly to the remaining day budget, which is computed from the rounded intakes. The day's budgets therefore add up to today's target, unless the ended slots' intake is already above it. When today's target changes during the day, only the open slots' budgets SHALL change; ended slots keep their intake. Protein budgets SHALL follow the same rules with today's protein target and the same shares, in whole grams. A next-slot operation SHALL report the coming slot, its budget and its remaining budget.

#### Scenario: Light lunch
- **WHEN** a person with a 2,000 kcal target and shares of 20, 30, 10 and 40 percent for breakfast, lunch, snack and dinner has eaten 400 kcal at breakfast and 300 kcal at lunch, and both windows have ended
- **THEN** breakfast's budget is 400 kcal and lunch's is 300 kcal, and the remaining 1,300 kcal gives the snack 260 kcal and dinner 1,040 kcal, a total of 2,000 kcal

#### Scenario: Heavy lunch
- **WHEN** the same person has eaten 400 kcal at breakfast and 900 kcal at lunch, and both windows have ended
- **THEN** the remaining 700 kcal gives the snack 140 kcal and dinner 560 kcal, a total of 2,000 kcal

#### Scenario: Overspend larger than the rest of the day
- **WHEN** the same person has eaten 400 kcal at breakfast and 1,700 kcal at lunch, and both windows have ended
- **THEN** the snack's and dinner's budgets are zero and the day's budgets total 2,100 kcal

#### Scenario: Last slot stays open
- **WHEN** the same person has eaten 400, 600 and 200 kcal at breakfast, lunch and snack and 600 kcal at dinner, and dinner's window has ended but the day has not
- **THEN** dinner's budget is 800 kcal with 200 kcal left, matching today's remaining 200 kcal, and a 150 kcal entry at 10 PM is stored in dinner and leaves 50 kcal

#### Scenario: Target changes during the day
- **WHEN** the same person has eaten 400 kcal at breakfast and 500 kcal at lunch, both windows have ended, and their target changes from 2,000 to 2,200 kcal that afternoon
- **THEN** breakfast and lunch keep budgets of 400 and 500 kcal, and the snack's and dinner's budgets move from 220 and 880 kcal to 260 and 1,040 kcal, a total of 2,200 kcal

#### Scenario: Rounding
- **WHEN** the remaining day budget is 1,001 kcal and the open slots are the snack and dinner
- **THEN** the snack's budget is 200 kcal and dinner's is 801 kcal

#### Scenario: Fractional intake
- **WHEN** the same person has eaten three quarters of a 610 kcal meal at breakfast (457.5 kcal) and breakfast's window has ended
- **THEN** breakfast's intake counts as 458 kcal, the remaining 1,542 kcal gives lunch 578 kcal (1,542 times 30 over 80, rounded down), the snack 192 kcal and dinner the remaining 772 kcal, the day's budgets total 2,000 kcal, and the entry keeps its 457.5 kcal

#### Scenario: Day type changed after breakfast
- **WHEN** a person logs 400 kcal at 8 AM and then changes today's day type to a template whose breakfast window also covers 8 AM
- **THEN** the entry counts toward the new template's breakfast and the day's budgets still add up to today's target

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
