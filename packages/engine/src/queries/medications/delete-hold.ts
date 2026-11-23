import type { Database } from "better-sqlite3";

export type DeleteHoldParams = {
  id: number;
};

export type DeleteHoldResult = {
  changes: number;
};

export function deleteHold(
  db: Database,
  params: DeleteHoldParams,
): DeleteHoldResult {
  const sql = `
	DELETE FROM medication_holds WHERE id = ?
	
	`;
  return db.prepare(sql).run([params.id]) as DeleteHoldResult;
}
