CREATE TABLE regular_meals (
  user_id INTEGER NOT NULL,
  food_id INTEGER NOT NULL,
  restaurant TEXT,
  baseline TEXT NOT NULL CHECK (baseline IN ('menu', 'label', 'estimate')),
  archived_at TEXT CHECK (archived_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', archived_at, '+0 seconds') IS archived_at),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  PRIMARY KEY (user_id, food_id),
  FOREIGN KEY (user_id, food_id) REFERENCES foods (user_id, id)
) STRICT;
