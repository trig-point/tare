UPDATE users SET body_units = :body_units WHERE id = :user_id
RETURNING body_units;
