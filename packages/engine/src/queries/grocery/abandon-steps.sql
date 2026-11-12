UPDATE grocery_steps SET state = 'abandoned', updated_at = :now WHERE request_id = :request_id AND state IN ('pending', 'uncertain');
