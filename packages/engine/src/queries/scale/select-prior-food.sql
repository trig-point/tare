SELECT created_at FROM first_food_times
WHERE user_id = :user_id AND day = :day AND created_at < :measured_at;
