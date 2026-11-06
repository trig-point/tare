SELECT status, day_type_id, fetched_at FROM calendar_cache
WHERE user_id = :user_id AND day = :day AND timezone = :timezone
AND day_start_hour = :day_start_hour AND revision = :revision LIMIT 1;
