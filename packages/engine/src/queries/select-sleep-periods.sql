SELECT id, day, started_at, ended_at, sleep_minutes FROM sleep_periods
WHERE user_id = :user_id AND day BETWEEN :from AND :to
ORDER BY day, sleep_minutes DESC, started_at, id;
