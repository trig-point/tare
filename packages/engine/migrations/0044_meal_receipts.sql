CREATE TABLE meal_receipts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  client_id TEXT NOT NULL,
  part_key TEXT NOT NULL UNIQUE CHECK (length(part_key) = 36),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  part_count INTEGER NOT NULL CHECK (part_count BETWEEN 1 AND 12),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  UNIQUE (user_id, client_id)
) STRICT;
