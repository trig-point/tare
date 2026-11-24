SELECT id, username, password_hash, timezone, day_start_hour, is_admin, created_at, access_email FROM users WHERE id = :id LIMIT 1;
