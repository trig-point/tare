import type { Database } from "better-sqlite3";

export type DeleteDayTypeParams = {
  user_id: number;
  id: number;
};

export type DeleteDayTypeResult = {
  id: number;
};

export function deleteDayType(
  db: Database,
  params: DeleteDayTypeParams,
): DeleteDayTypeResult | null {
  const sql = `
	DELETE FROM day_types WHERE user_id = ? AND id = ?
	RETURNING id;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToDeleteDayTypeResult(res) : null;
}

function mapArrayToDeleteDayTypeResult(data: any) {
  const result: DeleteDayTypeResult = {
    id: data[0],
  };
  return result;
}
