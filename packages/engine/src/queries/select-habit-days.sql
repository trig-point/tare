SELECT day, habit_key FROM habit_log
WHERE user_id = :user_id AND day BETWEEN :from AND :to ORDER BY day, habit_key;
