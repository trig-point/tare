UPDATE order_meals SET quantity = quantity - 1, revision = revision + 1, updated_at = :updated_at
WHERE user_id = :user_id AND id = :id AND revision = :revision AND quantity >= 1
RETURNING id, quantity, revision;
