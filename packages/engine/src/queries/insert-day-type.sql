INSERT INTO day_types (user_id, name, template_id)
VALUES (:user_id, :name, :template_id) RETURNING id, user_id, name, template_id;
