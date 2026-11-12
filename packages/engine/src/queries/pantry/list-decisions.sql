SELECT * FROM pantry_decisions WHERE request_id = :request_id ORDER BY created_at, number, kind;
