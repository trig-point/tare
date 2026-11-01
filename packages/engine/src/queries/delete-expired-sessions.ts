import type { Database } from "better-sqlite3";

export type DeleteExpiredSessionsParams = {
  now: string;
};

export type DeleteExpiredSessionsResult = {
  changes: number;
};

export function deleteExpiredSessions(
  db: Database,
  params: DeleteExpiredSessionsParams,
): DeleteExpiredSessionsResult {
  const sql = `
	DELETE FROM sessions WHERE expires_at <= ?;
	
	`;
  return db.prepare(sql).run([params.now]) as DeleteExpiredSessionsResult;
}
