import type { Database } from "better-sqlite3";

export type InsertStepParams = {
  request_id: number | null;
  number: number | null;
  kind: string;
  updated_at: string;
};

export type InsertStepResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertStep(
  db: Database,
  params: InsertStepParams,
): InsertStepResult {
  const sql = `
	INSERT INTO grocery_steps (request_id, number, kind, state, updated_at) VALUES (?, ?, ?, 'pending', ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.request_id,
      params.number,
      params.kind,
      params.updated_at,
    ]) as InsertStepResult;
}
