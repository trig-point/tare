SELECT user_id FROM inbound_tokens WHERE token_hash = :token_hash LIMIT 1;
