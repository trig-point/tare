SELECT habit_key, amount, note, source, updated_at FROM habit_log
WHERE user_id = :user_id AND day = :day ORDER BY habit_key;
