INSERT INTO day_templates (user_id, name, created_at)
VALUES (:user_id, :name, :created_at) RETURNING id, user_id, name, created_at;
