DELETE FROM day_types WHERE user_id = :user_id AND id = :id
RETURNING id;
