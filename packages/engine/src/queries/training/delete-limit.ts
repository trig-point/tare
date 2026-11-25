import type { Database } from "better-sqlite3";

export type DeleteLimitParams = {
  user_id: number;
  id: number;
};

export type DeleteLimitResult = {
  id: number;
};

export function deleteLimit(
  db: Database,
  params: DeleteLimitParams,
): DeleteLimitResult | null {
  const sql = `
	DELETE FROM training_limits
	WHERE user_id = ? AND id = ?
	RETURNING id;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToDeleteLimitResult(res) : null;
}

function mapArrayToDeleteLimitResult(data: any) {
  const result: DeleteLimitResult = {
    id: data[0],
  };
  return result;
}
