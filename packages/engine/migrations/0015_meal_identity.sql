ALTER TABLE foods ADD COLUMN service TEXT;
ALTER TABLE foods ADD COLUMN meal_name TEXT;
ALTER TABLE foods ADD COLUMN chef TEXT;
ALTER TABLE foods ADD COLUMN meal_key TEXT;

CREATE UNIQUE INDEX foods_meal_identity ON foods(user_id, meal_key)
WHERE meal_key IS NOT NULL;
