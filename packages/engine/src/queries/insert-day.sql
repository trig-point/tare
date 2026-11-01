INSERT INTO days (user_id, day, signed_off_at, hunger, fullness, notes)
VALUES (:user_id, :day, :signed_off_at, :hunger, :fullness, :notes) RETURNING *;
