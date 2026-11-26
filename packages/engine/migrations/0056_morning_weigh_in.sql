ALTER TABLE scale_readings ADD COLUMN day TEXT CHECK (date(day, '+0 days') IS day);

UPDATE scale_readings
SET day = (
  SELECT weights.day FROM weights
  WHERE weights.user_id = scale_readings.user_id
    AND weights.client_id = scale_readings.client_id
    AND weights.measured_at = substr(scale_readings.client_id, -24)
);

INSERT INTO scale_readings (client_id, user_id, created_at, day)
SELECT client_id, user_id, created_at, day FROM weights
WHERE source = 'scale' AND client_id GLOB 'scale:*'
  AND measured_at = substr(client_id, -24)
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO scale_readings (client_id, user_id, created_at)
SELECT subject_ref, user_id, min(created_at) FROM questions
WHERE kind = 'scale_implausible' AND user_id IS NOT NULL
GROUP BY subject_ref, user_id
ON CONFLICT (client_id) DO NOTHING;

CREATE INDEX scale_readings_user_day ON scale_readings (user_id, day);

CREATE VIEW undated_scale_readings AS
SELECT client_id, user_id,
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', substr(client_id, -24), '+0 seconds') = substr(client_id, -24)
    THEN substr(client_id, -24)
    ELSE created_at
  END AS possible_measured_at
FROM scale_readings
WHERE day IS NULL;

CREATE TABLE first_food_times (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS day),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  PRIMARY KEY (user_id, day)
) STRICT;

INSERT INTO first_food_times (user_id, day, created_at)
SELECT user_id, day, min(created_at) FROM intake_entries GROUP BY user_id, day;

CREATE TRIGGER record_first_food_insert AFTER INSERT ON intake_entries
BEGIN
  INSERT INTO first_food_times (user_id, day, created_at)
  VALUES (NEW.user_id, NEW.day, NEW.created_at)
  ON CONFLICT (user_id, day) DO UPDATE SET created_at = min(created_at, excluded.created_at);
END;

CREATE TRIGGER record_first_food_move AFTER UPDATE OF day ON intake_entries
WHEN NEW.day <> OLD.day
BEGIN
  INSERT INTO first_food_times (user_id, day, created_at)
  VALUES (NEW.user_id, NEW.day, OLD.created_at)
  ON CONFLICT (user_id, day) DO UPDATE SET created_at = min(created_at, excluded.created_at);
END;
