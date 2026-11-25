SELECT id, payload FROM activity_events
WHERE (user_id = :user_id OR user_id IS NULL) AND id > :after_id ORDER BY id;
