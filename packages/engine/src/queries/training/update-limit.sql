UPDATE training_limits
SET body_area = :body_area, description = :description, movements = :movements, status = :status, date_noted = :date_noted
WHERE user_id = :user_id AND id = :id
RETURNING id, body_area, description, movements, status, date_noted;
