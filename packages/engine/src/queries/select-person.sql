SELECT id, username, timezone, day_start_hour, is_admin
FROM users WHERE id = :id LIMIT 1;
