## ADDED Requirements

### Requirement: Log a meal from parts in grams
The system SHALL provide `log_meal_parts`, which logs a meal of 1 to 12 parts. Each part SHALL name exactly one catalog or source food and an amount in grams greater than zero, with an optional low and high gram amount. Grams SHALL be converted to servings against the food's mass basis, and each part SHALL be logged as an estimated amount of a referenced food, with its range from the gram range. All parts and the meal's receipt SHALL be written in one transaction: either every part is logged or none is. Repeating a request with the same client id and the same content SHALL return the stored entries in order without writing; the same client id with different content SHALL be refused with `mutation_conflict`. Part entries SHALL use client ids that no ordinary intake write can produce. The response SHALL list the entries with the meal's totals, marked incomplete when a part lacks a nutrient, and the summed range, which SHALL be empty when any part has none. A part that fails, including a malformed part, SHALL fail the request with a stable code and the part's one-based position, the same on HTTP and for agent callers. No pantry stock SHALL be consumed.

#### Scenario: Takeout lunch
- **WHEN** an agent logs rice 300 g (250 to 350) and chicken 170 g (140 to 200) against two source foods
- **THEN** two entries exist with provenance `estimated` and estimated amounts, each with its range, and the response totals both

#### Scenario: One bad part
- **WHEN** the second of three parts names a food stored per 100 ml
- **THEN** the request fails with `dimension_mismatch` for part 2 and no entry or receipt is written

#### Scenario: Replay
- **WHEN** the same request is sent twice with one client id
- **THEN** the entries exist once and the second call returns them in the same order

#### Scenario: Changed replay
- **WHEN** a second request reuses the client id with a different gram amount
- **THEN** it is refused with `mutation_conflict` and nothing changes

#### Scenario: Deleted part
- **WHEN** one part of a logged meal is deleted and the original request is sent again
- **THEN** it is refused with `meal_part_deleted` and nothing is written

#### Scenario: Malformed part over MCP
- **WHEN** an agent sends a meal whose second part has grams as text
- **THEN** the request fails with `invalid_part` for part 2, as it would over HTTP

#### Scenario: Another person's food
- **WHEN** the third part names a catalog food owned by a different person
- **THEN** the request fails with `food_not_found` for part 3 and nothing is written

### Requirement: Photo estimate
The system SHALL provide a photo estimate route that accepts one JPEG, PNG or WebP image up to 5 MiB, sends it to the configured vision model, and returns proposed parts with a name, a search query, grams and a gram range for each. The route SHALL NOT log anything, and the image SHALL NOT be written to disk, the database or any log. A vision reply that does not match the expected structure SHALL be reported as an invalid response, never as an empty list. With no vision model configured, the route SHALL answer `vision_unavailable`.

#### Scenario: Plate photo
- **WHEN** a person posts a photo of a plate with rice and chicken
- **THEN** the response proposes two parts with grams and ranges, and no entry is created

#### Scenario: Not configured
- **WHEN** no vision provider key is set
- **THEN** the route answers `vision_unavailable` and the Photo tab is hidden

#### Scenario: Too large
- **WHEN** the image is over 5 MiB
- **THEN** the route refuses it before calling the model

### Requirement: Photo tab
The add-food screen SHALL have a Photo tab that takes or picks one photo, shows the proposed parts with editable names and grams, lets the person choose a food for each part from candidates, and logs the meal with `log_meal_parts`. The tab SHALL be online-only and SHALL drop the photo after the estimate returns.

#### Scenario: Correct and log
- **WHEN** the person changes the rice from 300 g to 250 g, picks a cooked rice candidate, and taps Log
- **THEN** the meal is logged with 250 g of the chosen food and Today shows the new entries

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** the Photo tab says it needs a connection and queues nothing
