CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '+0 seconds') IS expires_at),
  CHECK (expires_at > created_at)
) STRICT;

CREATE INDEX sessions_user_id ON sessions (user_id);
