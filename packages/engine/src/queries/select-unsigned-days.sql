SELECT day, signed_off_at, hunger, fullness, notes FROM days
WHERE user_id = :user_id AND signed_off_at IS NULL AND day < :today
ORDER BY day DESC LIMIT 90;
