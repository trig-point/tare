-- tare:rebuild
CREATE TABLE daily_signals_replacement (
  user_id INTEGER NOT NULL REFERENCES users (id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  metric TEXT NOT NULL CHECK (metric IN ('steps', 'active_calories', 'sleep', 'sleep_score', 'resting_heart_rate', 'hrv', 'readiness', 'stress', 'stress_high', 'recovery_high', 'stress_summary')),
  value REAL NOT NULL,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  PRIMARY KEY (user_id, day, metric, source)
) STRICT;

INSERT INTO daily_signals_replacement (user_id, day, metric, value, source, updated_at)
SELECT user_id, day, metric, value, source, updated_at FROM daily_signals;
DROP TABLE daily_signals;
ALTER TABLE daily_signals_replacement RENAME TO daily_signals;

-- Connections synced before daily_sleep and daily_stress were read get one 30-day re-read of both.
ALTER TABLE oura_connections ADD COLUMN scores_backfilled_at TEXT
  CHECK (scores_backfilled_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', scores_backfilled_at, '+0 seconds') IS scores_backfilled_at);
