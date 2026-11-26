SELECT user_id, day, signed_off_at, hunger, fullness, notes FROM days WHERE user_id = :user_id AND day = :day LIMIT 1;
