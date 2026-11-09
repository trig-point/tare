INSERT INTO scale_readings (client_id, user_id, created_at)
VALUES (:client_id, :user_id, :created_at)
ON CONFLICT (client_id) DO NOTHING;
