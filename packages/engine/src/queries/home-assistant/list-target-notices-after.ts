import type { Database } from "better-sqlite3";

export type ListTargetNoticesAfterParams = {
  user_id: number;
  after_id: number;
};

export type ListTargetNoticesAfterResult = {
  id: number;
  old_kcal: number;
  old_protein_g: number;
  new_kcal: number;
  new_protein_g: number;
};

export function listTargetNoticesAfter(
  db: Database,
  params: ListTargetNoticesAfterParams,
): ListTargetNoticesAfterResult[] {
  const sql = `
	SELECT id, old_kcal, old_protein_g, new_kcal, new_protein_g
	FROM target_notices WHERE user_id = ? AND id > ? ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.after_id]);

  return rows.map((data) => mapArrayToListTargetNoticesAfterResult(data));
}

function mapArrayToListTargetNoticesAfterResult(data: any) {
  const result: ListTargetNoticesAfterResult = {
    id: data[0],
    old_kcal: data[1],
    old_protein_g: data[2],
    new_kcal: data[3],
    new_protein_g: data[4],
  };
  return result;
}
