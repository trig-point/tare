UPDATE pantry_requests SET state = 'rejected', reason = :reason
WHERE id = :id AND state = 'pending' AND user_id = :user_id AND generation = :generation AND product_id = :product_id AND stock_unit_id = :stock_unit_id
RETURNING id;
