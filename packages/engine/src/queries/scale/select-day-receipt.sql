SELECT client_id FROM scale_readings
WHERE user_id = :user_id AND day = :day
UNION ALL
SELECT client_id FROM scale_readings
WHERE user_id = :user_id AND day IS NULL
  AND possible_measured_at >= :start AND possible_measured_at < :end
LIMIT 1;
