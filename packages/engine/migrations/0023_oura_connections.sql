CREATE TABLE oura_connections (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  access_expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', access_expires_at, '+0 seconds') IS access_expires_at),
  scopes TEXT NOT NULL,
  scope_source TEXT NOT NULL CHECK (scope_source IN ('requested', 'response')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'reconnect_required', 'membership_required')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  last_synced_at TEXT CHECK (last_synced_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', last_synced_at, '+0 seconds') IS last_synced_at),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at)
) STRICT;

CREATE TABLE oura_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  verifier TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '+0 seconds') IS expires_at)
) STRICT;
CREATE INDEX oura_states_expiry ON oura_states(expires_at);
