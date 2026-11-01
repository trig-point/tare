INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, body_fat_pct, source, created_at)
VALUES (:user_id, :client_id, :measured_at, :day, :weight_kg, :body_fat_pct, :source, :created_at) RETURNING *;
