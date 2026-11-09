SELECT id, timing, started_at, day, duration_minutes, kind, calories, notes, source FROM activity_sessions
WHERE user_id = :user_id AND day BETWEEN :from AND :to
ORDER BY day, started_at IS NULL, started_at, id;
