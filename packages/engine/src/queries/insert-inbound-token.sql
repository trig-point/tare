INSERT INTO inbound_tokens (user_id, token_hash, created_at)
VALUES (:user_id, :token_hash, :created_at)
ON CONFLICT (user_id) DO NOTHING RETURNING user_id;
