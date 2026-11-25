UPDATE training_places
SET name = :name, notes = :notes
WHERE user_id = :user_id AND id = :id
RETURNING id, name, notes;
