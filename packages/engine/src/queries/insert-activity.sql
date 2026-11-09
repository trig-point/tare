INSERT INTO activity_sessions (user_id, client_id, timing, started_at, day, duration_minutes, kind, calories, notes, source, source_record_id, created_at)
VALUES (:user_id, :client_id, :timing, :started_at, :day, :duration_minutes, :kind, :calories, :notes, :source, NULL, :created_at)
ON CONFLICT (user_id, client_id) DO NOTHING RETURNING *;
