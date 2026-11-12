import type { Database } from "better-sqlite3";

export type InsertOutcomeParams = {
  intake_id: number | null;
  user_id: number;
  generation: number | null;
  request_id: string | null;
  reason: string | null;
};

export type InsertOutcomeResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertOutcome(
  db: Database,
  params: InsertOutcomeParams,
): InsertOutcomeResult {
  const sql = `
	INSERT INTO pantry_outcomes (intake_id, user_id, generation, request_id, reason) VALUES (?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.intake_id,
      params.user_id,
      params.generation,
      params.request_id,
      params.reason,
    ]) as InsertOutcomeResult;
}
