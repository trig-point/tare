DELETE FROM training_machines
WHERE user_id = :user_id AND id = :id
RETURNING id;
