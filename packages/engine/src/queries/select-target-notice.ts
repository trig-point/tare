import type { Database } from "better-sqlite3";

export type SelectTargetNoticeParams = {
  user_id: number;
};

export type SelectTargetNoticeResult = {
  id: number;
  created_at: string;
  old_kcal: number;
  old_protein_g: number;
  new_kcal: number;
  new_protein_g: number;
};

export function selectTargetNotice(
  db: Database,
  params: SelectTargetNoticeParams,
): SelectTargetNoticeResult | null {
  const sql = `
	SELECT id, created_at, old_kcal, old_protein_g, new_kcal, new_protein_g
	FROM target_notices
	WHERE user_id = ? AND dismissed_at IS NULL
	  AND id = (SELECT MAX(id) FROM target_notices WHERE user_id = ?);
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.user_id]);

  return res ? mapArrayToSelectTargetNoticeResult(res) : null;
}

function mapArrayToSelectTargetNoticeResult(data: any) {
  const result: SelectTargetNoticeResult = {
    id: data[0],
    created_at: data[1],
    old_kcal: data[2],
    old_protein_g: data[3],
    new_kcal: data[4],
    new_protein_g: data[5],
  };
  return result;
}
