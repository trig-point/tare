ALTER TABLE intake_entries ADD COLUMN eating_out INTEGER NOT NULL DEFAULT 0
  CHECK (eating_out IN (0, 1));
ALTER TABLE intake_entries ADD COLUMN kcal_basis TEXT NOT NULL DEFAULT 'legacy'
  CHECK (kcal_basis IN ('legacy', 'menu', 'label', 'other'));
ALTER TABLE intake_entries ADD COLUMN packaged_food INTEGER NOT NULL DEFAULT 0
  CHECK (packaged_food IN (0, 1));
ALTER TABLE install ADD COLUMN eating_out_started_at TEXT CHECK (
  eating_out_started_at IS NULL OR
  strftime('%Y-%m-%dT%H:%M:%fZ', eating_out_started_at, '+0 seconds') IS eating_out_started_at
);
UPDATE install SET eating_out_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE singleton = 1 AND eating_out_started_at IS NULL;

WITH legacy_restaurant_intake AS (
  SELECT intake.id
  FROM intake_entries AS intake
  JOIN foods AS food ON food.user_id = intake.user_id AND food.id = intake.food_id
  JOIN regular_meals AS meal ON meal.user_id = food.user_id AND meal.food_id = food.id
  WHERE trim(
      meal.restaurant,
      char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197,
        8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
    ) <> ''
    AND meal.baseline IN ('menu', 'estimate')
    AND intake.source_food_id IS NULL AND food.source_food_id IS NULL
    AND food.meal_key IS NULL AND (food.service IS NULL OR food.meal_name IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM meal_receipts AS part
      WHERE intake.client_id GLOB 'meal-part:*:*'
        AND part.part_key = substr(intake.client_id, 11, 36)
        AND part.user_id = intake.user_id AND part.created_at = intake.created_at
        AND intake.client_id = 'meal-part:' || part.part_key || ':' || CAST(substr(intake.client_id, 48) AS INTEGER)
        AND CAST(substr(intake.client_id, 48) AS INTEGER) BETWEEN 1 AND part.part_count
    )
    AND NOT EXISTS (
      SELECT 1 FROM meal_actions AS receipt
      WHERE receipt.user_id = intake.user_id AND receipt.intake_entry_id = intake.id
        AND receipt.mutation_id = intake.client_id AND receipt.created_at = intake.created_at
        AND receipt.order_meal_id IS NOT NULL
    )
)
UPDATE intake_entries SET eating_out = 1
WHERE id IN (SELECT id FROM legacy_restaurant_intake);
