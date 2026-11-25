ALTER TABLE activity_sets ADD COLUMN client_set_id TEXT
  CHECK (client_set_id IS NULL OR length(client_set_id) BETWEEN 1 AND 100);

CREATE UNIQUE INDEX activity_sets_client_set_id
  ON activity_sets (user_id, session_id, client_set_id)
  WHERE client_set_id IS NOT NULL;

CREATE TABLE activity_set_removals (
  user_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  client_set_id TEXT NOT NULL CHECK (length(client_set_id) BETWEEN 1 AND 100),
  PRIMARY KEY (user_id, session_id, client_set_id),
  FOREIGN KEY (user_id, session_id) REFERENCES activity_sessions (user_id, id) ON DELETE CASCADE
) STRICT;
