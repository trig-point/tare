## ADDED Requirements

### Requirement: Estimated amount of a referenced food
A person or agent SHALL be able to log a catalog or source food with its amount marked as estimated. The entry SHALL keep its reference to the food, take its values from the food times the servings, store that its amount is estimated, carry provenance `estimated`, and MAY carry a low and high number of servings from which its calorie range is computed. Editing the servings or the servings range of such an entry SHALL recompute its values and range from the current food. Marking the amount as measured SHALL recompute the entry at its servings, restore the food's provenance and any range the food itself carries, and clear the estimate. An entry with an estimated amount SHALL NOT consume pantry stock. A requested provenance that differs from the food's SHALL still be refused with `provenance_mismatch`.

#### Scenario: Estimated rice portion
- **WHEN** a USDA Foundation rice food stored per 100 g at 130 kcal is logged with 3 servings, low 2.5 and high 3.5, and the amount marked as estimated
- **THEN** the entry references the food, has 390 kcal, a range of 325 to 455 kcal, provenance `estimated`, and is marked as an estimated amount

#### Scenario: Weighed afterwards
- **WHEN** that entry is edited to 2.8 servings with the amount marked as measured
- **THEN** it has 364 kcal, no range, provenance `verified`, and is no longer marked as an estimated amount

#### Scenario: Food changed before an edit
- **WHEN** the referenced food's kcal changes and the entry's servings are then edited
- **THEN** its kcal and its range are both computed from the current food, and the range contains the kcal

#### Scenario: Owned estimated food
- **WHEN** a person logs their own food whose provenance is already `estimated` without marking the amount as estimated
- **THEN** the entry is not marked as an estimated amount, and marking a later edit as measured is refused

#### Scenario: Grocery food with an estimated amount
- **WHEN** a food bound to a pantry product is logged with its amount marked as estimated
- **THEN** no pantry stock is consumed and the entry records that it was not

#### Scenario: Other provenance still refused
- **WHEN** a USDA Foundation food is logged with provenance `label`
- **THEN** the request is refused with `provenance_mismatch` and nothing is written
