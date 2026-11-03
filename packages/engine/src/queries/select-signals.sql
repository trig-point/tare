SELECT metric, value, source FROM daily_signals
WHERE user_id = :user_id AND day = :day ORDER BY metric, source;
