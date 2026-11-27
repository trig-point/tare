-- tare:rebuild
CREATE TABLE activity_sets_replacement (
  user_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  set_index INTEGER NOT NULL CHECK (set_index >= 1),
  exercise TEXT NOT NULL CHECK (length(trim(exercise)) > 0),
  set_type TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup', 'working', 'drop', 'failure')),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  load_kg REAL CHECK (load_kg IS NULL OR load_kg >= 0),
  load_unit TEXT CHECK (load_unit IS NULL OR load_unit IN ('kg', 'lb', 'pin')),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  rir_low INTEGER CHECK (rir_low IS NULL OR rir_low BETWEEN 0 AND 10),
  rir_high INTEGER CHECK (rir_high IS NULL OR rir_high BETWEEN 0 AND 10),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  client_set_id TEXT CHECK (client_set_id IS NULL OR length(client_set_id) BETWEEN 1 AND 40),
  CHECK ((rir_low IS NULL) = (rir_high IS NULL) AND (rir_low IS NULL OR rir_low <= rir_high)),
  PRIMARY KEY (user_id, session_id, set_index),
  FOREIGN KEY (user_id, session_id) REFERENCES activity_sessions (user_id, id) ON DELETE CASCADE
) STRICT;

-- load_kg holds the pin number itself when load_unit is 'pin'.
INSERT INTO activity_sets_replacement (user_id, session_id, set_index, exercise, set_type, reps, load_kg, load_unit, duration_seconds, rir_low, rir_high, notes, client_set_id)
SELECT user_id, session_id, set_index, exercise, set_type, reps, load_kg, load_unit, duration_seconds, rir_low, rir_high, notes, client_set_id FROM activity_sets;
DROP TABLE activity_sets;
ALTER TABLE activity_sets_replacement RENAME TO activity_sets;
CREATE UNIQUE INDEX activity_sets_client_set_id
  ON activity_sets (user_id, session_id, client_set_id)
  WHERE client_set_id IS NOT NULL;
