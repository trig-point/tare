SELECT * FROM pantry_requests WHERE state IN ('delivered', 'cancelled', 'abandoned') AND resolved_at >= :since ORDER BY resolved_at DESC, id;
