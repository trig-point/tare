CREATE TABLE day_templates (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, id)
) STRICT;

CREATE TABLE template_slots (
  user_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440 AND start_minute < end_minute),
  share_bp INTEGER NOT NULL CHECK (share_bp > 0),
  fill_hint TEXT CHECK (fill_hint IS NULL OR length(fill_hint) <= 200),
  PRIMARY KEY (user_id, template_id, position),
  FOREIGN KEY (user_id, template_id) REFERENCES day_templates(user_id, id)
) STRICT;

CREATE TABLE day_types (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  template_id INTEGER NOT NULL,
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, template_id) REFERENCES day_templates(user_id, id)
) STRICT;

CREATE TABLE default_day_types (
  user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id),
  day_type_id INTEGER NOT NULL,
  FOREIGN KEY (user_id, day_type_id) REFERENCES day_types(user_id, id)
) STRICT;

CREATE TABLE day_type_choices (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS NOT NULL AND date(day, '+0 days') = day),
  day_type_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id, day_type_id) REFERENCES day_types(user_id, id)
) STRICT;
