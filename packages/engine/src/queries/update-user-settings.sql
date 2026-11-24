UPDATE users SET day_start_hour = :day_start_hour WHERE id = :id RETURNING id, username, password_hash, timezone, day_start_hour, is_admin, created_at, access_email;
