import type { Database } from "better-sqlite3";

export type RecoverRequestsData = {
  uncertain_since: string | null;
  updated_at: string | null;
};

export type RecoverRequestsResult = {
  changes: number;
};

export function recoverRequests(
  db: Database,
  data: RecoverRequestsData,
): RecoverRequestsResult {
  const sql = `
	UPDATE pantry_requests SET state = 'uncertain', claim_token = NULL, attempt_count = attempt_count + 1, uncertain_since = ?, updated_at = ?,
	  reason = CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' WHEN state = 'uncertain' THEN reason ELSE 'restarted' END
	WHERE state = 'sending' OR (state = 'pending' AND EXISTS (SELECT 1 FROM pantry_backup_marker)) OR (state = 'uncertain' AND uncertain_since IS NULL);
	
	`;
  return db
    .prepare(sql)
    .run([data.uncertain_since, data.updated_at]) as RecoverRequestsResult;
}
