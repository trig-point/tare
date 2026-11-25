SELECT id, name, notes
FROM training_places
WHERE user_id = :user_id
ORDER BY id;
