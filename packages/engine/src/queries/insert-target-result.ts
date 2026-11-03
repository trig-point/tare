import type { Database } from "better-sqlite3";

export type InsertTargetResultParams = {
  user_id: number;
  computed_at: string;
  trigger: string;
  kcal: number;
  protein_g: number;
  basis: string;
  tdee_kcal: number | null;
  low_kcal: number | null;
  high_kcal: number | null;
};

export type InsertTargetResultResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertTargetResult(
  db: Database,
  params: InsertTargetResultParams,
): InsertTargetResultResult {
  const sql = `
	INSERT INTO target_results (user_id, computed_at, trigger, kcal, protein_g, basis, tdee_kcal, low_kcal, high_kcal)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.computed_at,
      params.trigger,
      params.kcal,
      params.protein_g,
      params.basis,
      params.tdee_kcal,
      params.low_kcal,
      params.high_kcal,
    ]) as InsertTargetResultResult;
}
