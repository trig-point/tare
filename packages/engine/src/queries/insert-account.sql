INSERT INTO users (username, password_hash, timezone, is_admin, created_at)
VALUES (:username, :password_hash, :timezone, :is_admin, :created_at)
RETURNING id, username, timezone, day_start_hour, is_admin, created_at;
