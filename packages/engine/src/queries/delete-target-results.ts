import type { Database } from "better-sqlite3";

export type DeleteTargetResultsParams = {
  user_id: number;
};

export type DeleteTargetResultsResult = {
  changes: number;
};

export function deleteTargetResults(
  db: Database,
  params: DeleteTargetResultsParams,
): DeleteTargetResultsResult {
  const sql = `
	DELETE FROM target_results WHERE user_id = ?;
	
	`;
  return db.prepare(sql).run([params.user_id]) as DeleteTargetResultsResult;
}
