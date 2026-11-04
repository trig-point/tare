import type { Database } from "better-sqlite3";

export type DeleteExpiredStatesParams = {
  now: string;
};

export type DeleteExpiredStatesResult = {
  changes: number;
};

export function deleteExpiredStates(
  db: Database,
  params: DeleteExpiredStatesParams,
): DeleteExpiredStatesResult {
  const sql = `
	DELETE FROM oura_states WHERE expires_at <= ?;
	
	`;
  return db.prepare(sql).run([params.now]) as DeleteExpiredStatesResult;
}
