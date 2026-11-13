UPDATE grocery_requests SET state = :state, updated_at = :now WHERE id = :id AND state = :expected_state RETURNING id;
