SELECT users.id, users.username, users.timezone, users.day_start_hour, users.is_admin, sessions.expires_at
FROM sessions INNER JOIN users ON users.id = sessions.user_id
WHERE sessions.token_hash = :token_hash AND sessions.expires_at > :now LIMIT 1;
