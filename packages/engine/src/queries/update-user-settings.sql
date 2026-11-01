UPDATE users SET day_start_hour = :day_start_hour WHERE id = :id RETURNING *;
