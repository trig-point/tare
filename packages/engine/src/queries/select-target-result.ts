import type { Database } from "better-sqlite3";

export type SelectTargetResultParams = {
  user_id: number;
};

export type SelectTargetResultResult = {
  id: number;
  computed_at: string;
  trigger: string;
  kcal: number;
  protein_g: number;
  basis: string;
  tdee_kcal: number | null;
  low_kcal: number | null;
  high_kcal: number | null;
};

export function selectTargetResult(
  db: Database,
  params: SelectTargetResultParams,
): SelectTargetResultResult | null {
  const sql = `
	SELECT id, computed_at, trigger, kcal, protein_g, basis, tdee_kcal, low_kcal, high_kcal
	FROM target_results WHERE user_id = ?
	ORDER BY computed_at DESC, id DESC LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectTargetResultResult(res) : null;
}

function mapArrayToSelectTargetResultResult(data: any) {
  const result: SelectTargetResultResult = {
    id: data[0],
    computed_at: data[1],
    trigger: data[2],
    kcal: data[3],
    protein_g: data[4],
    basis: data[5],
    tdee_kcal: data[6],
    low_kcal: data[7],
    high_kcal: data[8],
  };
  return result;
}
