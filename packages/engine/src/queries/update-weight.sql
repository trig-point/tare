UPDATE weights SET measured_at = :measured_at, day = :day, weight_kg = :weight_kg, body_fat_pct = :body_fat_pct WHERE user_id = :user_id AND id = :id RETURNING *;
