ALTER TABLE intake_entries ADD COLUMN amount_estimated INTEGER NOT NULL DEFAULT 0 CHECK (
  amount_estimated IN (0, 1)
  AND (amount_estimated = 0 OR (
    (food_id IS NOT NULL OR source_food_id IS NOT NULL)
    AND servings IS NOT NULL AND provenance = 'estimated'
  ))
);
ALTER TABLE intake_entries ADD COLUMN servings_low REAL;
ALTER TABLE intake_entries ADD COLUMN servings_high REAL CHECK (
  (servings_low IS NULL AND servings_high IS NULL)
  OR (
    servings_low IS NOT NULL AND servings_high IS NOT NULL
    AND amount_estimated = 1 AND servings IS NOT NULL
    AND 0 < servings_low AND servings_low <= servings AND servings <= servings_high
  )
);
