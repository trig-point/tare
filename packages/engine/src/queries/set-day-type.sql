INSERT INTO day_type_choices (user_id, day, day_type_id) VALUES (:user_id, :day, :day_type_id)
ON CONFLICT (user_id, day) DO UPDATE SET day_type_id = excluded.day_type_id;
