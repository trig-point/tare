DELETE FROM agent_tokens WHERE user_id = :user_id AND id = :id RETURNING id;
