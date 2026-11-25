DELETE FROM activity_sets
WHERE user_id = :user_id AND session_id = :session_id AND client_set_id = :client_set_id;
