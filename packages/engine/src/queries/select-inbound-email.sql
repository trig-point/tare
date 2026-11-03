SELECT id FROM inbound_emails WHERE user_id = :user_id AND dedupe_key = :dedupe_key LIMIT 1;
