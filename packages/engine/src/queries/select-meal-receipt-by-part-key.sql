SELECT created_at, part_count FROM meal_receipts WHERE user_id = :user_id AND part_key = :part_key LIMIT 1;
