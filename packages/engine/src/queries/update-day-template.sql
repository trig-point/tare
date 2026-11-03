UPDATE day_templates SET name = :name WHERE user_id = :user_id AND id = :id
RETURNING id, user_id, name, created_at;
