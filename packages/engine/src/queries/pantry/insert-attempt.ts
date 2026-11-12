import type { Database } from "better-sqlite3";

export type InsertAttemptParams = {
  request_id: string;
  number: number | null;
  token: string | null;
  started_at: string | null;
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
	INSERT INTO pantry_attempts (request_id, number, kind, token, outcome, started_at) VALUES (?, ?, 'network', ?, 'sending', ?);
	
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
