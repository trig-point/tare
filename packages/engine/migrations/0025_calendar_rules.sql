CREATE TABLE calendar_settings (
  user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id),
  feed_url TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((enabled = 1 AND feed_url IS NOT NULL) OR (enabled = 0 AND feed_url IS NULL))
) STRICT;

CREATE TABLE calendar_rules (
  user_id INTEGER NOT NULL REFERENCES calendar_settings(user_id),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
  keyword TEXT NOT NULL,
  day_type_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, position),
  FOREIGN KEY (user_id, day_type_id) REFERENCES day_types(user_id, id)
) STRICT;
CREATE INDEX calendar_rules_day_type ON calendar_rules(user_id, day_type_id);

CREATE TABLE calendar_cache (
  user_id INTEGER NOT NULL REFERENCES calendar_settings(user_id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS NOT NULL AND date(day, '+0 days') = day),
  timezone TEXT NOT NULL,
  day_start_hour INTEGER NOT NULL CHECK (day_start_hour BETWEEN 0 AND 23),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('match', 'no_match', 'unavailable')),
  day_type_id INTEGER,
  fetched_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', fetched_at, '+0 seconds') IS fetched_at),
  PRIMARY KEY (user_id, day, timezone, day_start_hour, revision),
  FOREIGN KEY (user_id, day_type_id) REFERENCES day_types(user_id, id),
  CHECK ((status = 'match' AND day_type_id IS NOT NULL) OR (status <> 'match' AND day_type_id IS NULL))
) STRICT;
CREATE INDEX calendar_cache_day_type ON calendar_cache(user_id, day_type_id);
