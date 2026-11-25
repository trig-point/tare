INSERT INTO training_machines (user_id, place_id, name, notes, photo_urls, movements)
VALUES (:user_id, :place_id, :name, :notes, :photo_urls, :movements)
RETURNING id, place_id, name, notes, photo_urls, movements;
