import type { Database } from "better-sqlite3";

export type DeleteWeightParams = {
  user_id: number;
  id: number;
};

export type DeleteWeightResult = {
  id: number;
};

export function deleteWeight(
  db: Database,
  params: DeleteWeightParams,
): DeleteWeightResult[] {
  const sql = `
	DELETE FROM weights WHERE user_id = ? AND id = ? RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.id]);

  return rows.map((data) => mapArrayToDeleteWeightResult(data));
}

function mapArrayToDeleteWeightResult(data: any) {
  const result: DeleteWeightResult = {
    id: data[0],
  };
  return result;
}
