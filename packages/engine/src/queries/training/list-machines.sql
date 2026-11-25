SELECT id, place_id, name, notes, photo_urls, movements
FROM training_machines
WHERE user_id = :user_id
ORDER BY id;
