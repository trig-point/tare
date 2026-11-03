SELECT id, user_id, name, template_id FROM day_types
WHERE user_id = :user_id AND id = :id;
