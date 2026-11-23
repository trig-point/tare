UPDATE medication_holds SET to_date = :to_date WHERE id = :id
RETURNING *
