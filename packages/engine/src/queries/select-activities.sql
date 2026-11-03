SELECT id, started_at, duration_minutes, kind, calories, source FROM activity_sessions
WHERE user_id = :user_id AND day = :day ORDER BY started_at, id;
