import type { Database } from "better-sqlite3";

export type RecordActivitySetRemovalsParams = {
  user_id: number;
  session_id: number;
};

export type RecordActivitySetRemovalsResult = {
  changes: number;
  lastInsertRowid: number;
};

export function recordActivitySetRemovals(
  db: Database,
  params: RecordActivitySetRemovalsParams,
): RecordActivitySetRemovalsResult {
  const sql = `
	INSERT INTO activity_set_removals (user_id, session_id, client_set_id)
	SELECT user_id, session_id, client_set_id FROM activity_sets
	WHERE user_id = ? AND session_id = ? AND client_set_id IS NOT NULL
	ON CONFLICT (user_id, session_id, client_set_id) DO NOTHING;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.session_id,
    ]) as RecordActivitySetRemovalsResult;
}
