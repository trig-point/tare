UPDATE planned_items SET order_meal_id = :order_meal_id, food_id = :food_id, servings = :servings,
revision = revision + 1, updated_at = :updated_at
WHERE user_id = :user_id AND day = :day AND template_id = :template_id AND position = :position
AND state = 'planned' AND id = :id AND revision = :revision
RETURNING *;
