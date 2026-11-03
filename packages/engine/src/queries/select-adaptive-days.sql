SELECT day
FROM days
WHERE user_id = :user_id AND day >= :start AND day <= :end
  AND signed_off_at IS NOT NULL
ORDER BY day;
