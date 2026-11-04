SELECT order_meals.*, EXISTS (SELECT 1 FROM meal_actions
WHERE meal_actions.user_id = order_meals.user_id AND order_meal_id = order_meals.id)
OR EXISTS (SELECT 1 FROM planned_items
WHERE planned_items.user_id = order_meals.user_id AND order_meal_id = order_meals.id) AS has_actions
FROM order_meals WHERE user_id = :user_id AND order_id = :order_id ORDER BY id;
