SELECT id, body_area, description, movements, status, date_noted
FROM training_limits
WHERE user_id = :user_id AND status = 'active'
ORDER BY id;
