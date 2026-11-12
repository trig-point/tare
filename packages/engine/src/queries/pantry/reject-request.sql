UPDATE pantry_requests SET state = 'rejected', reason = :reason, attempt_count = attempt_count + 1, updated_at = :now
WHERE id = :id AND state = 'pending' AND user_id = :user_id AND generation = :generation AND product_id = :product_id AND stock_unit_id = :stock_unit_id
RETURNING id, attempt_count;
