UPDATE order_meals SET name = :name, chef = :chef, quantity = :quantity,
revision = revision + 1, updated_at = :updated_at
WHERE user_id = :user_id AND id = :id RETURNING *;
