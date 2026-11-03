INSERT INTO order_meals (user_id, order_id, name, chef, quantity, updated_at)
VALUES (:user_id, :order_id, :name, :chef, :quantity, :updated_at) RETURNING *;
