SELECT order_meals.id, order_meals.order_id, order_meals.name, order_meals.chef,
order_meals.quantity, order_meals.revision, orders.delivery_date, orders.delivered_at
FROM order_meals JOIN orders ON orders.user_id = order_meals.user_id AND orders.id = order_meals.order_id
WHERE order_meals.user_id = :user_id AND order_meals.quantity > 0
ORDER BY orders.delivery_date, order_meals.id;
