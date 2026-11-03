INSERT INTO default_day_types (user_id, day_type_id) VALUES (:user_id, :day_type_id)
ON CONFLICT (user_id) DO UPDATE SET day_type_id = excluded.day_type_id;
