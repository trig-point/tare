UPDATE pantry_requests SET state = 'cancelled', resolved_at = :resolved_at, updated_at = :updated_at WHERE state = 'pending';
