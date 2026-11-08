CREATE TABLE target_notices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  old_kcal INTEGER NOT NULL,
  old_protein_g INTEGER NOT NULL CHECK (old_protein_g >= 0),
  new_kcal INTEGER NOT NULL,
  new_protein_g INTEGER NOT NULL CHECK (new_protein_g >= 0),
  dismissed_at TEXT CHECK (dismissed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', dismissed_at, '+0 seconds') IS dismissed_at)
) STRICT;
CREATE INDEX target_notices_user ON target_notices(user_id, id DESC);
