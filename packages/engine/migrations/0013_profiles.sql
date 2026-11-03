CREATE TABLE profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  height_cm REAL NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
  birth_date TEXT NOT NULL CHECK (date(birth_date, '+0 days') IS birth_date),
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  activity_level TEXT NOT NULL CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  goal_rate_kg_week REAL NOT NULL CHECK (goal_rate_kg_week BETWEEN -1.5 AND 1.0),
  protein_factor REAL NOT NULL DEFAULT 1.6 CHECK (protein_factor BETWEEN 0.8 AND 3.0),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at)
) STRICT;
