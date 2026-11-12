UPDATE pantry_requests SET state = 'uncertain', claim_token = NULL, attempt_count = attempt_count + 1, uncertain_since = :uncertain_since, updated_at = :updated_at,
  reason = CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' WHEN state = 'uncertain' THEN reason ELSE 'restarted' END
WHERE state = 'sending' OR (state = 'pending' AND EXISTS (SELECT 1 FROM pantry_backup_marker)) OR (state = 'uncertain' AND uncertain_since IS NULL);
