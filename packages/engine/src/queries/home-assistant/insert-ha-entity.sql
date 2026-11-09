INSERT INTO ha_entities (user_id, topic) VALUES (:user_id, :topic) ON CONFLICT DO NOTHING;
