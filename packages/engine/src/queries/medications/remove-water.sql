UPDATE daily_signals SET value = max(0, value - :amount), updated_at = :updated_at
WHERE user_id = :user_id AND day = :day AND metric = 'water' AND source = 'agent'
