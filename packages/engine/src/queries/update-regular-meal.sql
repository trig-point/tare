UPDATE regular_meals SET restaurant = :restaurant, baseline = :baseline
WHERE user_id = :user_id AND food_id = :id AND archived_at IS NULL RETURNING food_id;
