SELECT * FROM pantry_requests WHERE state IN ('pending', 'sending', 'uncertain', 'rejected') ORDER BY created_at, id;
