UPDATE pantry_requests SET state = 'uncertain', claim_token = NULL, reason = CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' ELSE 'restarted' END
WHERE state = 'sending' OR (state = 'pending' AND EXISTS (SELECT 1 FROM pantry_backup_marker));
