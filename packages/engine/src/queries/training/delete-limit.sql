DELETE FROM training_limits
WHERE user_id = :user_id AND id = :id
RETURNING id;
