CREATE TABLE daily_signals (
  user_id INTEGER NOT NULL REFERENCES users (id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  metric TEXT NOT NULL CHECK (metric IN ('steps', 'active_calories', 'sleep', 'resting_heart_rate', 'hrv', 'readiness', 'stress')),
  value REAL NOT NULL,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  PRIMARY KEY (user_id, day, metric, source)
) STRICT;

CREATE TABLE activity_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  client_id TEXT,
  started_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+0 seconds') IS started_at),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  calories REAL CHECK (calories IS NULL OR calories >= 0),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_record_id TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  UNIQUE (user_id, id),
  UNIQUE (user_id, client_id),
  UNIQUE (user_id, source, source_record_id)
) STRICT;
CREATE INDEX activity_sessions_user_day ON activity_sessions (user_id, day);
