UPDATE grocery_steps SET state = 'uncertain', claim_token = NULL, updated_at = :now,
  reason = CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' ELSE 'restarted' END
WHERE state = 'sending'
  OR (state = 'pending' AND EXISTS (SELECT 1 FROM pantry_backup_marker) AND request_id IN (SELECT id FROM grocery_requests WHERE state = 'open'));
