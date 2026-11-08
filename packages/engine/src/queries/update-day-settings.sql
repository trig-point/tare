UPDATE users SET timezone = :timezone, day_start_hour = :day_start_hour WHERE id = :id
RETURNING id, username, timezone, day_start_hour, is_admin;
