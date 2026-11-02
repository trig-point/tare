UPDATE agent_tokens SET last_used_at = :now WHERE client_id = :client_id RETURNING user_id;
