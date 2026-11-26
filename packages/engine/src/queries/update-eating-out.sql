UPDATE intake_entries SET eating_out = :eating_out WHERE user_id = :user_id AND id = :id RETURNING *;
