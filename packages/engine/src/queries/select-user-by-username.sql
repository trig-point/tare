SELECT id, username, password_hash, timezone, day_start_hour, is_admin
FROM users WHERE username = :username LIMIT 1;
