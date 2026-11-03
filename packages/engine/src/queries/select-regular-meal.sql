SELECT foods.user_id, foods.id, foods.name, foods.serving_size, foods.serving_unit,
  foods.kcal, foods.protein_g, foods.carbs_g, foods.fat_g, foods.fiber_g,
  foods.kcal_low, foods.kcal_high, foods.provenance, foods.source, foods.source_food_id,
  regular_meals.restaurant, regular_meals.baseline, regular_meals.created_at
FROM regular_meals
JOIN foods ON foods.user_id = regular_meals.user_id AND foods.id = regular_meals.food_id
WHERE regular_meals.user_id = :user_id AND regular_meals.food_id = :id
  AND regular_meals.archived_at IS NULL LIMIT 1;
