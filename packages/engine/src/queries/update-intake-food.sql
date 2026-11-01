UPDATE intake_entries SET food_id = :food_id, updated_at = :updated_at WHERE user_id = :user_id AND id = :id RETURNING *;
