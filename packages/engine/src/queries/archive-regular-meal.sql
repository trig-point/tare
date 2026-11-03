UPDATE regular_meals SET archived_at = :archived_at
WHERE user_id = :user_id AND food_id = :id AND archived_at IS NULL RETURNING food_id;
