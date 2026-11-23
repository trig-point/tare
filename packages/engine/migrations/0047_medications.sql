CREATE TABLE medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  late_after_minutes INTEGER NOT NULL DEFAULT 60 CHECK (late_after_minutes >= 0),
  generated_until TEXT NOT NULL
) STRICT;

CREATE TABLE medication_schedule_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL REFERENCES medications(id),
  effective_from TEXT NOT NULL,
  effective_to TEXT CHECK (effective_to >= effective_from),
  timezone TEXT NOT NULL,
  days TEXT NOT NULL CHECK (json_valid(days) AND json_type(days) = 'array'),
  times TEXT NOT NULL CHECK (json_valid(times) AND json_type(times) = 'array' AND json_array_length(times) > 0)
) STRICT;
CREATE UNIQUE INDEX medication_open_revision ON medication_schedule_revisions (medication_id)
WHERE effective_to IS NULL;

CREATE TABLE medication_doses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL UNIQUE,
  medication_id INTEGER NOT NULL REFERENCES medications(id),
  revision_id INTEGER NOT NULL REFERENCES medication_schedule_revisions(id),
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  slot_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'taken', 'skipped')),
  taken_at TEXT,
  skip_reason TEXT CHECK (skip_reason IN ('user', 'stopped')),
  CHECK ((status = 'taken') = (taken_at IS NOT NULL)),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  UNIQUE (medication_id, slot_date, slot_time)
) STRICT;

CREATE TABLE medication_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL REFERENCES medications(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL CHECK (to_date >= date(from_date, '-1 day'))
) STRICT;
CREATE INDEX medication_holds_by_medication ON medication_holds (medication_id);
