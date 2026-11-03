DELETE FROM intake_entries WHERE user_id = :user_id AND id = :id RETURNING id;
