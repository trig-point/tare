SELECT id, day
FROM activity_sessions
WHERE user_id = :user_id AND source IN ('manual', 'agent')
ORDER BY day DESC, started_at DESC, id DESC
LIMIT 5;
