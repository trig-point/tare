import type { Database } from "better-sqlite3";

export type InsertLocalRejectionParams = {
  request_id: string;
  number: number | null;
  reason: string | null;
  finished_at: string | null;
};

export type InsertLocalRejectionResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertLocalRejection(
  db: Database,
  params: InsertLocalRejectionParams,
): InsertLocalRejectionResult {
  const sql = `
	INSERT INTO pantry_attempts (request_id, number, kind, outcome, reason, finished_at) VALUES (?, ?, 'local_rejection', 'rejected', ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.request_id,
      params.number,
      params.reason,
      params.finished_at,
    ]) as InsertLocalRejectionResult;
}
