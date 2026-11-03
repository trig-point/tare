SELECT * FROM intake_entries
WHERE user_id = :user_id AND day = :day
ORDER BY eaten_at, id;
