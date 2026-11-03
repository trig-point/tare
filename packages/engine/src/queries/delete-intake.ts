import type { Database } from "better-sqlite3";

export type DeleteIntakeParams = {
  user_id: number;
  id: number;
};

export type DeleteIntakeResult = {
  id: number;
};

export function deleteIntake(
  db: Database,
  params: DeleteIntakeParams,
): DeleteIntakeResult[] {
  const sql = `
	DELETE FROM intake_entries WHERE user_id = ? AND id = ? RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.id]);

  return rows.map((data) => mapArrayToDeleteIntakeResult(data));
}

function mapArrayToDeleteIntakeResult(data: any) {
  const result: DeleteIntakeResult = {
    id: data[0],
  };
  return result;
}
