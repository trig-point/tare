import type { Database } from "better-sqlite3";

export type ListAttemptsParams = {
  request_id: string;
};

export type ListAttemptsResult = {
  request_id: string;
  number: number;
  kind: string;
  token: string | null;
  outcome: string;
  reason: string | null;
  http_status: number | null;
  receipt: string | null;
  started_at: string | null;
  finished_at: string | null;
  uncertain_since: string | null;
  recovered_from_number: number | null;
};

export function listAttempts(
  db: Database,
  params: ListAttemptsParams,
): ListAttemptsResult[] {
  const sql = `
	SELECT * FROM pantry_attempts WHERE request_id = ? ORDER BY number;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.request_id]);

  return rows.map((data) => mapArrayToListAttemptsResult(data));
}

function mapArrayToListAttemptsResult(data: any) {
  const result: ListAttemptsResult = {
    request_id: data[0],
    number: data[1],
    kind: data[2],
    token: data[3],
    outcome: data[4],
    reason: data[5],
    http_status: data[6],
    receipt: data[7],
    started_at: data[8],
    finished_at: data[9],
    uncertain_since: data[10],
    recovered_from_number: data[11],
  };
  return result;
}
