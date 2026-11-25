CREATE TABLE movements (
  user_id INTEGER NOT NULL REFERENCES users (id),
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND name = trim(name)),
  setup TEXT NOT NULL CHECK (json_valid(setup) AND json_type(setup) = 'array'),
  cues TEXT NOT NULL CHECK (json_valid(cues) AND json_type(cues) = 'array'),
  mistakes TEXT NOT NULL CHECK (json_valid(mistakes) AND json_type(mistakes) = 'array'),
  safety TEXT NOT NULL CHECK (json_valid(safety) AND json_type(safety) = 'array'),
  pictures TEXT NOT NULL CHECK (json_valid(pictures) AND json_type(pictures) = 'array'),
  rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  source TEXT,
  equipment TEXT,
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  UNIQUE (user_id, name COLLATE NOCASE)
) STRICT;
