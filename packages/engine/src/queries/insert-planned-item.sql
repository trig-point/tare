INSERT INTO planned_items (user_id, day, template_id, position, order_meal_id, food_id, servings, created_at, updated_at)
VALUES (:user_id, :day, :template_id, :position, :order_meal_id, :food_id, :servings, :created_at, :updated_at)
RETURNING *;
