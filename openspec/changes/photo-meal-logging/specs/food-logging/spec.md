## ADDED Requirements

### Requirement: Estimated amount of a referenced food
A person or agent SHALL be able to log a catalog or source food with provenance `estimated` to mark the amount as an estimate. The entry SHALL keep its reference to the food and take its values from the food times the servings. It SHALL carry provenance `estimated` and MAY carry a low and high number of servings, from which the entry's calorie range is computed. Asking for any other provenance that differs from the food's SHALL still be refused with `provenance_mismatch`. Editing the servings of such an entry SHALL rescale its range, and marking the amount as measured SHALL restore the food's provenance and clear the range.

#### Scenario: Estimated rice portion
- **WHEN** a USDA Foundation rice food stored per 100 g at 130 kcal is logged with 3 servings, low 2.5 and high 3.5, and provenance `estimated`
- **THEN** the entry references the food, has 390 kcal, a range of 325 to 455 kcal and provenance `estimated`

#### Scenario: Weighed afterwards
- **WHEN** that entry is edited to 2.8 servings with the amount marked as measured
- **THEN** it has 364 kcal, no range and provenance `verified`

#### Scenario: Amount edited without weighing
- **WHEN** that entry is edited to 4 servings without marking the amount as measured
- **THEN** it has 520 kcal and a range of about 433 to 607 kcal, scaled by the same ratio

#### Scenario: Other provenance still refused
- **WHEN** a USDA Foundation food is logged with provenance `label`
- **THEN** the request is refused with `provenance_mismatch` and nothing is written
