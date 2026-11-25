CREATE TABLE training_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  notes TEXT,
  UNIQUE (user_id, id)
) STRICT;

CREATE TABLE training_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  place_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  notes TEXT,
  photo_urls TEXT NOT NULL CHECK (json_valid(photo_urls) AND json_type(photo_urls) = 'array'),
  movements TEXT NOT NULL CHECK (json_valid(movements) AND json_type(movements) = 'array'),
  FOREIGN KEY (user_id, place_id) REFERENCES training_places(user_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX training_machines_place ON training_machines(user_id, place_id);

CREATE TABLE training_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body_area TEXT NOT NULL,
  description TEXT NOT NULL,
  movements TEXT NOT NULL CHECK (json_valid(movements) AND json_type(movements) = 'array'),
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
  date_noted TEXT NOT NULL CHECK (date(date_noted, '+0 days') IS date_noted)
) STRICT;
CREATE INDEX training_limits_status ON training_limits(user_id, status);
