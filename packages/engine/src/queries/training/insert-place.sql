INSERT INTO training_places (user_id, name, notes)
VALUES (:user_id, :name, :notes)
RETURNING id, name, notes;
