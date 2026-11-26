SELECT created_at FROM first_food_times
WHERE user_id = :user_id AND day = :day AND created_at < :measured_at
UNION ALL
SELECT created_at FROM legacy_food_times
WHERE user_id = :user_id AND eaten_at >= :start AND eaten_at < :end
  AND created_at < :measured_at
LIMIT 1;
