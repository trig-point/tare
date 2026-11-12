import type { Database } from "better-sqlite3";

export type RecoverAttemptsData = {
  finished_at: string | null;
  uncertain_since: string | null;
};

export type RecoverAttemptsResult = {
  changes: number;
};

export function recoverAttempts(
  db: Database,
  data: RecoverAttemptsData,
): RecoverAttemptsResult {
  const sql = `
	UPDATE pantry_attempts SET outcome = 'uncertain', reason = CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' ELSE 'restarted' END, finished_at = ?, uncertain_since = ? WHERE outcome = 'sending';
	
	`;
  return db
    .prepare(sql)
    .run([data.finished_at, data.uncertain_since]) as RecoverAttemptsResult;
}
