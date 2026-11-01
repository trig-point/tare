UPDATE foods SET kcal = :kcal WHERE user_id = :user_id AND id = :id RETURNING *;
