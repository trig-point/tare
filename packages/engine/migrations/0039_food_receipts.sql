-- Owner-scoped replay record for create_food; grocery requests keep their own receipts.
CREATE TABLE food_receipts (
  user_id INTEGER NOT NULL REFERENCES users(id),
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) = 36),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  food_id INTEGER NOT NULL,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  PRIMARY KEY (user_id, mutation_id),
  FOREIGN KEY (user_id, food_id) REFERENCES foods (user_id, id)
) STRICT;
