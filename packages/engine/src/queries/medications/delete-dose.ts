import type { Database } from "better-sqlite3";

export type DeleteDoseParams = {
  id: number;
};

export type DeleteDoseResult = {
  changes: number;
};

export function deleteDose(
  db: Database,
  params: DeleteDoseParams,
): DeleteDoseResult {
  const sql = `
	DELETE FROM medication_doses WHERE id = ? AND status = 'scheduled'
	
	`;
  return db.prepare(sql).run([params.id]) as DeleteDoseResult;
}
