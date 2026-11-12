import type { Database } from "better-sqlite3";

export type ReadOutcomeParams = {
  user_id: number;
  intake_id: number;
};

export type ReadOutcomeResult = {
  generation: number | null;
  request_id: string | null;
  reason: string | null;
};

export function readOutcome(
  db: Database,
  params: ReadOutcomeParams,
): ReadOutcomeResult | null {
  const sql = `
	SELECT generation, request_id, reason FROM pantry_outcomes WHERE user_id = ? AND intake_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.intake_id]);

  return res ? mapArrayToReadOutcomeResult(res) : null;
}

function mapArrayToReadOutcomeResult(data: any) {
  const result: ReadOutcomeResult = {
    generation: data[0],
    request_id: data[1],
    reason: data[2],
  };
  return result;
}
