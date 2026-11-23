INSERT INTO medication_holds (medication_id, from_date, to_date)
VALUES (:medication_id, :from_date, :to_date)
RETURNING *
