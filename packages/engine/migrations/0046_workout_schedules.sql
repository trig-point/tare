CREATE TABLE workout_schedules (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  document TEXT NOT NULL CHECK (json_valid(document) AND json_type(document) = 'object'),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at)
) STRICT;
