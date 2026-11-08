INSERT INTO activity_sessions (user_id, client_id, started_at, day, duration_minutes, kind, calories, source, source_record_id, created_at)
VALUES (:user_id, NULL, :started_at, :day, :duration_minutes, :kind, :calories, :source, :source_record_id, :created_at)
ON CONFLICT (user_id, source, source_record_id) DO UPDATE SET
  started_at = excluded.started_at, day = excluded.day, duration_minutes = excluded.duration_minutes,
  kind = excluded.kind, calories = excluded.calories
RETURNING id;
