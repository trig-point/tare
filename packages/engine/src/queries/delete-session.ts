import type { Database } from "better-sqlite3";

export type DeleteSessionParams = {
  token_hash: string;
};

export type DeleteSessionResult = {
  changes: number;
};

export function deleteSession(
  db: Database,
  params: DeleteSessionParams,
): DeleteSessionResult {
  const sql = `
	DELETE FROM sessions WHERE token_hash = ?;
	
	`;
  return db.prepare(sql).run([params.token_hash]) as DeleteSessionResult;
}
