DELETE FROM training_places
WHERE user_id = :user_id AND id = :id
RETURNING id;
