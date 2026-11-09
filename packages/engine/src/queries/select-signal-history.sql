SELECT day, metric, value, source FROM daily_signals
WHERE user_id = :user_id AND day BETWEEN :from AND :to
  AND metric IN ('active_calories', 'hrv', 'resting_heart_rate', 'sleep')
ORDER BY metric, source, day;
