SELECT day, measured_at, id, weight_kg
FROM weights
WHERE user_id = :user_id AND day <= :day AND measured_at < :measured_at
ORDER BY day, measured_at, id;
