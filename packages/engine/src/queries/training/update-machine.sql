UPDATE training_machines
SET place_id = :place_id, name = :name, notes = :notes, photo_urls = :photo_urls, movements = :movements
WHERE user_id = :user_id AND id = :id
RETURNING id, place_id, name, notes, photo_urls, movements;
