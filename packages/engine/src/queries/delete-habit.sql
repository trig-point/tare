DELETE FROM habit_log WHERE user_id = :user_id AND day = :day AND habit_key = :habit_key RETURNING day, habit_key;
