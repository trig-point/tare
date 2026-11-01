INSERT INTO users (username, password_hash, timezone, created_at)
VALUES (:username, :password_hash, :timezone, :created_at) RETURNING *;
