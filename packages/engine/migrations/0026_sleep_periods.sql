CREATE TABLE sleep_periods (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_record_id TEXT NOT NULL CHECK (length(source_record_id) > 0),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  started_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+0 seconds') IS started_at),
  ended_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ended_at, '+0 seconds') IS ended_at),
  sleep_minutes INTEGER NOT NULL CHECK (sleep_minutes BETWEEN 0 AND 1440),
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  CHECK (ended_at > started_at),
  UNIQUE (user_id, source, source_record_id)
) STRICT;
CREATE INDEX sleep_periods_user_day ON sleep_periods (user_id, day);
