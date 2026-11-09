DELETE FROM activity_sessions WHERE user_id = :user_id AND id = :id RETURNING id;
