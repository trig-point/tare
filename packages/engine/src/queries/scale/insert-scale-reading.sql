INSERT INTO scale_readings (client_id, user_id, created_at, day)
VALUES (:client_id, :user_id, :created_at, :day)
ON CONFLICT (client_id) DO NOTHING;
