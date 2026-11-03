CREATE TABLE target_results (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  computed_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', computed_at, '+0 seconds') IS computed_at),
  trigger TEXT NOT NULL CHECK (trigger IN ('weekly', 'profile')),
  kcal INTEGER NOT NULL,
  protein_g INTEGER NOT NULL CHECK (protein_g >= 0),
  basis TEXT NOT NULL CHECK (basis IN ('adaptive', 'formula')),
  tdee_kcal REAL,
  low_kcal REAL,
  high_kcal REAL,
  CHECK (
    (basis = 'adaptive' AND tdee_kcal IS NOT NULL AND low_kcal IS NOT NULL AND high_kcal IS NOT NULL)
    OR (basis = 'formula' AND tdee_kcal IS NULL AND low_kcal IS NULL AND high_kcal IS NULL)
  )
) STRICT;
CREATE INDEX target_results_user_computed ON target_results(user_id, computed_at DESC, id DESC);
