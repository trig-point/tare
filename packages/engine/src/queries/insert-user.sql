INSERT INTO users (username, password_hash, timezone, created_at)
VALUES (:username, :password_hash, :timezone, :created_at) RETURNING id, username, password_hash, timezone, day_start_hour, is_admin, created_at, access_email;
