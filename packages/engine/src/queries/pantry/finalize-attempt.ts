import type { Database } from "better-sqlite3";

export type FinalizeAttemptData = {
  outcome: string;
  reason: string | null;
  http_status: number | null;
  receipt: string | null;
  finished_at: string | null;
};

export type FinalizeAttemptParams = {
  token: string;
};

export type FinalizeAttemptResult = {
  changes: number;
};

export function finalizeAttempt(
  db: Database,
  data: FinalizeAttemptData,
  params: FinalizeAttemptParams,
): FinalizeAttemptResult {
  const sql = `
	UPDATE pantry_attempts SET outcome = ?, reason = ?, http_status = ?, receipt = ?, finished_at = ? WHERE token = ? AND outcome = 'sending';
	
	`;
  return db
    .prepare(sql)
    .run([
      data.outcome,
      data.reason,
      data.http_status,
      data.receipt,
      data.finished_at,
      params.token,
    ]) as FinalizeAttemptResult;
}
