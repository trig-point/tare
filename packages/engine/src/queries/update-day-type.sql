UPDATE day_types SET name = :name, template_id = :template_id
WHERE user_id = :user_id AND id = :id RETURNING id, user_id, name, template_id;
