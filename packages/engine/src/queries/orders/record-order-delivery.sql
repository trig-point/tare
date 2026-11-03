UPDATE orders SET delivered_at = :delivered_at
WHERE user_id = :user_id AND id = :id AND delivered_at IS NULL RETURNING id;
