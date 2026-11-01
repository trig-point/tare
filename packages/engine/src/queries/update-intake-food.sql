UPDATE intake_entries SET food_id = :food_id WHERE user_id = :user_id AND id = :id RETURNING *;
