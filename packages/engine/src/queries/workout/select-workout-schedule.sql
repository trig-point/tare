SELECT user_id, document, updated_at
FROM workout_schedules
WHERE user_id = :user_id;
