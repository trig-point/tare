SELECT id, name, serving_size, serving_unit FROM foods
WHERE user_id = :user_id AND name LIKE '%' || :pattern || '%' ESCAPE '!'
AND NOT EXISTS (
  SELECT 1 FROM regular_meals
  WHERE regular_meals.user_id = foods.user_id AND regular_meals.food_id = foods.id
    AND regular_meals.archived_at IS NOT NULL
)
ORDER BY name, id
LIMIT 20;
