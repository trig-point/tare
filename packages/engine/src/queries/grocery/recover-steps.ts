import type { Database } from "better-sqlite3";

export type RecoverStepsData = {
  now: string;
};

export type RecoverStepsResult = {
  changes: number;
};

export function recoverSteps(
  db: Database,
  data: RecoverStepsData,
): RecoverStepsResult {
  const sql = `
	UPDATE grocery_steps SET state = 'uncertain', claim_token = NULL, updated_at = ?,
	  reason = CASE WHEN EXISTS (SELECT 1 FROM pantry_backup_marker) THEN 'restored_backup' ELSE 'restarted' END
	WHERE state = 'sending'
	  OR (state = 'pending' AND EXISTS (SELECT 1 FROM pantry_backup_marker) AND request_id IN (SELECT id FROM grocery_requests WHERE state = 'open'));
	
	`;
  return db.prepare(sql).run([data.now]) as RecoverStepsResult;
}
