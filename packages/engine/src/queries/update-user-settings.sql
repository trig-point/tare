UPDATE users SET day_start_hour = :day_start_hour, is_admin = :is_admin WHERE id = :id RETURNING *;
