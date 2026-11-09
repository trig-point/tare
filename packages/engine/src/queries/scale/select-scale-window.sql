SELECT id FROM weights
WHERE user_id = :user_id AND source = 'scale'
  AND measured_at BETWEEN :from AND :to
LIMIT 1;
