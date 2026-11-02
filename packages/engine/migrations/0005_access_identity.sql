-- tare:rebuild
CREATE TABLE users_replacement (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  timezone TEXT NOT NULL,
  day_start_hour INTEGER NOT NULL DEFAULT 4 CHECK (day_start_hour BETWEEN 0 AND 23),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  access_email TEXT UNIQUE
) STRICT;

INSERT INTO users_replacement (id, username, password_hash, timezone, day_start_hour, is_admin, created_at)
SELECT id, username, password_hash, timezone, day_start_hour, is_admin, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_replacement RENAME TO users;
