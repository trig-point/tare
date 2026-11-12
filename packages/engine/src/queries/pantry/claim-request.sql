UPDATE pantry_requests SET state = 'sending', attempt_count = attempt_count + 1, claim_token = :claim_token, updated_at = :now
WHERE id = :id AND state = 'pending' AND user_id = :user_id AND generation = :generation AND product_id = :product_id AND stock_unit_id = :stock_unit_id
RETURNING id, user_id, generation, product_id, stock_unit_id, quantity, attempt_count, claim_token;
