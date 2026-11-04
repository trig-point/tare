CREATE TABLE oura_connections (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  scopes TEXT NOT NULL,
  scope_source TEXT NOT NULL CHECK (scope_source IN ('requested', 'response')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'reconnect_required', 'membership_required')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE oura_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  verifier TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX oura_states_expiry ON oura_states(expires_at);
