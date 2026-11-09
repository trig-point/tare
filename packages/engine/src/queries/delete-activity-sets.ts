import type { Database } from "better-sqlite3";

export type DeleteActivitySetsParams = {
  user_id: number;
  session_id: number;
};

export type DeleteActivitySetsResult = {
  changes: number;
};

export function deleteActivitySets(
  db: Database,
  params: DeleteActivitySetsParams,
): DeleteActivitySetsResult {
  const sql = `
	DELETE FROM activity_sets WHERE user_id = ? AND session_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.session_id]) as DeleteActivitySetsResult;
}
