SELECT * FROM weights
WHERE user_id = :user_id AND day = :day
ORDER BY measured_at, id;
