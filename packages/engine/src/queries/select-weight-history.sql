SELECT day, measured_at, id, weight_kg, body_fat_pct
FROM weights
WHERE user_id = :user_id
ORDER BY day, measured_at, id;
