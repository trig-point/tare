INSERT INTO training_limits (user_id, body_area, description, movements, status, date_noted)
VALUES (:user_id, :body_area, :description, :movements, :status, :date_noted)
RETURNING id, body_area, description, movements, status, date_noted;
