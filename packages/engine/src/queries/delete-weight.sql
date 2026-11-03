DELETE FROM weights WHERE user_id = :user_id AND id = :id RETURNING id;
