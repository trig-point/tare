SELECT id, product_id, stock_unit_id FROM pantry_requests WHERE user_id = :user_id AND generation = :generation AND state = 'pending' ORDER BY created_at, id;
