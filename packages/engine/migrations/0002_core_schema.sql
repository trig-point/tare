DROP TABLE foundation;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  timezone TEXT NOT NULL,
  day_start_hour INTEGER NOT NULL DEFAULT 4 CHECK (day_start_hour BETWEEN 0 AND 23),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at)
) STRICT;

CREATE TABLE source_foods (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('usda', 'off')),
  source_key TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  serving_size REAL CHECK (serving_size IS NULL OR serving_size > 0),
  serving_unit TEXT,
  kcal REAL CHECK (kcal IS NULL OR kcal >= 0),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('verified', 'label')),
  fetched_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', fetched_at, '+0 seconds') IS fetched_at),
  UNIQUE (source, source_key)
) STRICT;

CREATE TABLE foods (
  user_id INTEGER NOT NULL REFERENCES users (id),
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  serving_size REAL CHECK (serving_size IS NULL OR serving_size > 0),
  serving_unit TEXT,
  kcal REAL CHECK (kcal IS NULL OR kcal >= 0),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
  kcal_low REAL CHECK (kcal_low IS NULL OR kcal_low >= 0),
  kcal_high REAL CHECK (kcal_high IS NULL OR kcal_high >= 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('verified', 'label', 'estimated')),
  source TEXT,
  source_food_id INTEGER REFERENCES source_foods (id),
  UNIQUE (user_id, id),
  CHECK ((kcal_low IS NULL) = (kcal_high IS NULL)),
  CHECK (kcal_low IS NULL OR kcal_low <= kcal_high),
  CHECK (kcal IS NULL OR kcal_low IS NULL OR (kcal_low <= kcal AND kcal <= kcal_high))
) STRICT;

CREATE TABLE intake_entries (
  user_id INTEGER NOT NULL REFERENCES users (id),
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL,
  food_id INTEGER,
  source_food_id INTEGER REFERENCES source_foods (id),
  servings REAL CHECK (servings IS NULL OR servings > 0),
  eaten_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', eaten_at, '+0 seconds') IS eaten_at),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  kcal REAL CHECK (kcal IS NULL OR kcal >= 0),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
  kcal_low REAL CHECK (kcal_low IS NULL OR kcal_low >= 0),
  kcal_high REAL CHECK (kcal_high IS NULL OR kcal_high >= 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('verified', 'label', 'estimated')),
  source TEXT,
  portion_note TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  UNIQUE (user_id, id),
  UNIQUE (user_id, client_id),
  FOREIGN KEY (user_id, food_id) REFERENCES foods (user_id, id),
  CHECK (food_id IS NULL OR source_food_id IS NULL),
  CHECK ((kcal_low IS NULL) = (kcal_high IS NULL)),
  CHECK (kcal_low IS NULL OR kcal_low <= kcal_high),
  CHECK (kcal IS NULL OR kcal_low IS NULL OR (kcal_low <= kcal AND kcal <= kcal_high))
) STRICT;
CREATE INDEX intake_entries_user_day ON intake_entries (user_id, day);

CREATE TABLE weights (
  user_id INTEGER NOT NULL REFERENCES users (id),
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL,
  measured_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', measured_at, '+0 seconds') IS measured_at),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  body_fat_pct REAL CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 0 AND 100),
  source TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  UNIQUE (user_id, id),
  UNIQUE (user_id, client_id)
) STRICT;
CREATE INDEX weights_user_day ON weights (user_id, day);

CREATE TABLE days (
  user_id INTEGER NOT NULL REFERENCES users (id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  signed_off_at TEXT CHECK (signed_off_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', signed_off_at, '+0 seconds') IS signed_off_at),
  hunger INTEGER,
  fullness INTEGER,
  notes TEXT,
  PRIMARY KEY (user_id, day)
) STRICT;
