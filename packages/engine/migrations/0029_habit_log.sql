-- A row means the habit happened; a day without one is not logged, so there is no done column.
CREATE TABLE habit_log (
  user_id INTEGER NOT NULL REFERENCES users (id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  habit_key TEXT NOT NULL CHECK (length(trim(habit_key)) > 0),
  amount REAL CHECK (amount IS NULL OR amount > 0),
  note TEXT CHECK (note IS NULL OR length(trim(note)) > 0),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  PRIMARY KEY (user_id, day, habit_key)
) STRICT;
