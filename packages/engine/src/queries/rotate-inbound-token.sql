UPDATE inbound_tokens SET token_hash = :token_hash, created_at = :created_at
WHERE user_id = :user_id RETURNING user_id;
