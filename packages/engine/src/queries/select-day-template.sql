SELECT id, user_id, name, created_at FROM day_templates
WHERE user_id = :user_id AND id = :id;
