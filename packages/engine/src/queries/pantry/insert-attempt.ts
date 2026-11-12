import type { Database } from "better-sqlite3";

export type InsertAttemptParams = {
  request_id: string;
  number: number | null;
  token: string;
  started_at: string;
};

export type InsertAttemptResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertAttempt(
  db: Database,
  params: InsertAttemptParams,
): InsertAttemptResult {
  const sql = `
	INSERT INTO pantry_attempts (request_id, number, token, outcome, started_at) VALUES (?, ?, ?, 'sending', ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.request_id,
      params.number,
      params.token,
      params.started_at,
    ]) as InsertAttemptResult;
}
