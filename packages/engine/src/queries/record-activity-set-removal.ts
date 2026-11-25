import type { Database } from "better-sqlite3";

export type RecordActivitySetRemovalParams = {
  user_id: number | null;
  session_id: number | null;
  client_set_id: string;
};

export type RecordActivitySetRemovalResult = {
  changes: number;
  lastInsertRowid: number;
};

export function recordActivitySetRemoval(
  db: Database,
  params: RecordActivitySetRemovalParams,
): RecordActivitySetRemovalResult {
  const sql = `
	INSERT INTO activity_set_removals (user_id, session_id, client_set_id)
	VALUES (?, ?, ?)
	ON CONFLICT (user_id, session_id, client_set_id) DO NOTHING;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.session_id,
      params.client_set_id,
    ]) as RecordActivitySetRemovalResult;
}
