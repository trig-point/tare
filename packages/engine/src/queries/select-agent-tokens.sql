SELECT * FROM agent_tokens WHERE user_id = :user_id ORDER BY created_at DESC, id DESC;
