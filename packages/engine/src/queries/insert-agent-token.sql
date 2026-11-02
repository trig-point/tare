INSERT INTO agent_tokens (user_id, client_id, name, created_at)
VALUES (:user_id, :client_id, :name, :created_at)
RETURNING *;
