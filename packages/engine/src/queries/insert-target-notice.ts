import type { Database } from "better-sqlite3";

export type InsertTargetNoticeParams = {
  user_id: number;
  created_at: string;
  old_kcal: number;
  old_protein_g: number;
  new_kcal: number;
  new_protein_g: number;
};

export type InsertTargetNoticeResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertTargetNotice(
  db: Database,
  params: InsertTargetNoticeParams,
): InsertTargetNoticeResult {
  const sql = `
	INSERT INTO target_notices (user_id, created_at, old_kcal, old_protein_g, new_kcal, new_protein_g)
	VALUES (?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.created_at,
      params.old_kcal,
      params.old_protein_g,
      params.new_kcal,
      params.new_protein_g,
    ]) as InsertTargetNoticeResult;
}
