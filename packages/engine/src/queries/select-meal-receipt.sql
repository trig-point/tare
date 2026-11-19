SELECT part_key, request_hash, part_count FROM meal_receipts
WHERE user_id = :user_id AND client_id = :client_id LIMIT 1;
