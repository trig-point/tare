DELETE FROM order_meals WHERE user_id = :user_id AND id = :id
AND NOT EXISTS (SELECT 1 FROM meal_actions WHERE user_id = :user_id AND order_meal_id = :id);
