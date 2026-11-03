DELETE FROM day_templates WHERE user_id = :user_id AND id = :id
RETURNING id;
