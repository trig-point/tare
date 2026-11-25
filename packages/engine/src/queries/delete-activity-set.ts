import type { Database } from "better-sqlite3";

export type DeleteActivitySetParams = {
  user_id: number;
  session_id: number;
  client_set_id: string;
};

export type DeleteActivitySetResult = {
  changes: number;
};

export function deleteActivitySet(
  db: Database,
  params: DeleteActivitySetParams,
): DeleteActivitySetResult {
  const sql = `
	DELETE FROM activity_sets
	WHERE user_id = ? AND session_id = ? AND client_set_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.session_id,
      params.client_set_id,
    ]) as DeleteActivitySetResult;
}
