CREATE TABLE scale_readings (
  client_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at)
) STRICT;
