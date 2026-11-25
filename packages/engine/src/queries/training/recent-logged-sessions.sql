SELECT id, timing, started_at, day, duration_minutes, kind, calories, notes, source, client_id
FROM activity_sessions
WHERE user_id = :user_id AND source IN ('manual', 'agent')
ORDER BY day DESC, started_at DESC, id DESC
LIMIT 5;
