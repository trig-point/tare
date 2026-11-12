SELECT count(*) AS unresolved FROM pantry_requests WHERE state IN ('sending', 'uncertain', 'rejected');
