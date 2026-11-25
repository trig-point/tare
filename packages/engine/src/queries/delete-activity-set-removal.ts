import type { Database } from "better-sqlite3";

export type DeleteActivitySetRemovalParams = {
  user_id: number;
  session_id: number;
  client_set_id: string;
};

export type DeleteActivitySetRemovalResult = {
  changes: number;
};

export function deleteActivitySetRemoval(
  db: Database,
  params: DeleteActivitySetRemovalParams,
): DeleteActivitySetRemovalResult {
  const sql = `
	DELETE FROM activity_set_removals
	WHERE user_id = ? AND session_id = ? AND client_set_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.session_id,
      params.client_set_id,
    ]) as DeleteActivitySetRemovalResult;
}
