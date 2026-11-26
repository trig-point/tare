SELECT day FROM daily_signals
WHERE user_id = :user_id AND source = 'oura'
ORDER BY day LIMIT 1;
