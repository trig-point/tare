SELECT orders.service, order_meals.name, order_meals.chef
FROM order_meals JOIN orders ON orders.user_id = order_meals.user_id AND orders.id = order_meals.order_id
WHERE order_meals.user_id = :user_id
ORDER BY order_meals.id DESC;
