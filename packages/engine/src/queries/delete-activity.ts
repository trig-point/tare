import type { Database } from "better-sqlite3";

export type DeleteActivityParams = {
  user_id: number;
  id: number;
};

export type DeleteActivityResult = {
  id: number;
};

export function deleteActivity(
  db: Database,
  params: DeleteActivityParams,
): DeleteActivityResult[] {
  const sql = `
	DELETE FROM activity_sessions WHERE user_id = ? AND id = ? RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.id]);

  return rows.map((data) => mapArrayToDeleteActivityResult(data));
}

function mapArrayToDeleteActivityResult(data: any) {
  const result: DeleteActivityResult = {
    id: data[0],
  };
  return result;
}
