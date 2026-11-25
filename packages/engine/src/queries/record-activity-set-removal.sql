INSERT INTO activity_set_removals (user_id, session_id, client_set_id)
VALUES (:user_id, :session_id, :client_set_id)
ON CONFLICT (user_id, session_id, client_set_id) DO NOTHING;
