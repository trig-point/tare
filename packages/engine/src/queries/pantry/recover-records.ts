import type { Database } from "better-sqlite3";

export type RecoverRecordsParams = {
  now: string | null;
};

export type RecoverRecordsResult = {
  changes: number;
  lastInsertRowid: number;
};

export function recoverRecords(
  db: Database,
  params: RecoverRecordsParams,
): RecoverRecordsResult {
  const sql = `
	INSERT INTO pantry_attempts (request_id, number, kind, outcome, reason, finished_at, uncertain_since, recovered_from_number)
	SELECT id, attempt_count + 1, 'recovery', 'uncertain',
	  CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' WHEN state = 'uncertain' THEN reason ELSE 'restarted' END,
	  ?, ?, CASE WHEN state = 'sending' THEN attempt_count END
	FROM pantry_requests WHERE state = 'sending' OR (state = 'pending' AND EXISTS (SELECT 1 FROM pantry_backup_marker)) OR (state = 'uncertain' AND uncertain_since IS NULL);
	
	`;
  return db.prepare(sql).run([params.now, params.now]) as RecoverRecordsResult;
}
