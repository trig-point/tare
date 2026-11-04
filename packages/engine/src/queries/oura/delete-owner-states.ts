import type { Database } from "better-sqlite3";

export type DeleteOwnerStatesParams = {
  user_id: number;
};

export type DeleteOwnerStatesResult = {
  changes: number;
};

export function deleteOwnerStates(
  db: Database,
  params: DeleteOwnerStatesParams,
): DeleteOwnerStatesResult {
  const sql = `
	DELETE FROM oura_states WHERE user_id = ?;
	
	`;
  return db.prepare(sql).run([params.user_id]) as DeleteOwnerStatesResult;
}
