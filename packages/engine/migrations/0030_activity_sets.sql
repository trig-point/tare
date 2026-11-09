-- tare:rebuild
CREATE TABLE activity_sessions_replacement (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  client_id TEXT,
  timing TEXT NOT NULL DEFAULT 'exact' CHECK (timing IN ('exact', 'date_only')),
  started_at TEXT CHECK (started_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+0 seconds') IS started_at),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  calories REAL CHECK (calories IS NULL OR calories >= 0),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_record_id TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  CHECK (
    (timing = 'exact' AND started_at IS NOT NULL AND duration_minutes IS NOT NULL)
    OR (timing = 'date_only' AND started_at IS NULL AND duration_minutes IS NULL)
  ),
  UNIQUE (user_id, id),
  UNIQUE (user_id, client_id),
  UNIQUE (user_id, source, source_record_id)
) STRICT;

INSERT INTO activity_sessions_replacement (id, user_id, client_id, timing, started_at, day, duration_minutes, kind, calories, notes, source, source_record_id, created_at)
SELECT id, user_id, client_id, 'exact', started_at, day, duration_minutes, kind, calories, NULL, source, source_record_id, created_at FROM activity_sessions;
DROP TABLE activity_sessions;
ALTER TABLE activity_sessions_replacement RENAME TO activity_sessions;
CREATE INDEX activity_sessions_user_day ON activity_sessions (user_id, day);

CREATE TABLE activity_sets (
  user_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  set_index INTEGER NOT NULL CHECK (set_index >= 1),
  exercise TEXT NOT NULL CHECK (length(trim(exercise)) > 0),
  set_type TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup', 'working', 'drop', 'failure')),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  load_kg REAL CHECK (load_kg IS NULL OR load_kg >= 0),
  load_unit TEXT CHECK (load_unit IS NULL OR load_unit IN ('kg', 'lb')),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  rir_low INTEGER CHECK (rir_low IS NULL OR rir_low BETWEEN 0 AND 10),
  rir_high INTEGER CHECK (rir_high IS NULL OR rir_high BETWEEN 0 AND 10),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  CHECK ((rir_low IS NULL) = (rir_high IS NULL) AND (rir_low IS NULL OR rir_low <= rir_high)),
  PRIMARY KEY (user_id, session_id, set_index),
  FOREIGN KEY (user_id, session_id) REFERENCES activity_sessions (user_id, id) ON DELETE CASCADE
) STRICT;
