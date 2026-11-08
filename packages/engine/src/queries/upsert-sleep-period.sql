INSERT INTO sleep_periods (user_id, source, source_record_id, day, started_at, ended_at, sleep_minutes, kind, updated_at)
VALUES (:user_id, :source, :source_record_id, :day, :started_at, :ended_at, :sleep_minutes, :kind, :updated_at)
ON CONFLICT (user_id, source, source_record_id) DO UPDATE SET
  day = excluded.day, started_at = excluded.started_at, ended_at = excluded.ended_at,
  sleep_minutes = excluded.sleep_minutes, kind = excluded.kind, updated_at = excluded.updated_at
RETURNING id;
