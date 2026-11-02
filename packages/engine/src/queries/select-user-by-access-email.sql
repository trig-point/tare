SELECT id, username, timezone, day_start_hour, is_admin
FROM users WHERE access_email = :access_email LIMIT 1;
