DELETE FROM activity_set_removals
WHERE user_id = :user_id AND session_id = :session_id AND client_set_id = :client_set_id;
