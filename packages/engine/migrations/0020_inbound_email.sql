CREATE TABLE inbound_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at)
) STRICT;

CREATE TABLE inbound_emails (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT,
  mark TEXT NOT NULL CHECK (mark IN ('verified', 'sender_matched', 'unverified')),
  dedupe_key TEXT NOT NULL,
  raw BLOB NOT NULL,
  subject_attached INTEGER NOT NULL CHECK (subject_attached IN (0, 1)),
  parse_state TEXT NOT NULL CHECK (parse_state IN ('queued', 'held', 'parsed', 'failed', 'no_model')),
  parse_result TEXT,
  reason_class TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  UNIQUE (user_id, dedupe_key)
) STRICT;
CREATE INDEX inbound_emails_queue ON inbound_emails(parse_state, id);
