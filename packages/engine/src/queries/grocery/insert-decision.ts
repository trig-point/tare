import type { Database } from "better-sqlite3";

export type InsertDecisionParams = {
  user_id: number | null;
  mutation_id: string;
  decision_hash: string;
  request_id: number;
  step_number: number | null;
  decision: string;
  resulting_state: string;
  created_at: string;
};

export type InsertDecisionResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertDecision(
  db: Database,
  params: InsertDecisionParams,
): InsertDecisionResult {
  const sql = `
	INSERT INTO grocery_decisions (user_id, mutation_id, decision_hash, request_id, step_number, decision, resulting_state, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.mutation_id,
      params.decision_hash,
      params.request_id,
      params.step_number,
      params.decision,
      params.resulting_state,
      params.created_at,
    ]) as InsertDecisionResult;
}
