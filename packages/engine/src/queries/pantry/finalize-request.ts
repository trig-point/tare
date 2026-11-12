import type { Database } from "better-sqlite3";

export type FinalizeRequestData = {
  state: string;
  reason: string | null;
};

export type FinalizeRequestParams = {
  id: string;
  claim_token: string;
};

export type FinalizeRequestResult = {
  id: string;
};

export function finalizeRequest(
  db: Database,
  data: FinalizeRequestData,
  params: FinalizeRequestParams,
): FinalizeRequestResult[] {
  const sql = `
	UPDATE pantry_requests SET state = ?, reason = ?, claim_token = NULL WHERE id = ? AND state = 'sending' AND claim_token = ? RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.state, data.reason, params.id, params.claim_token]);

  return rows.map((data) => mapArrayToFinalizeRequestResult(data));
}

function mapArrayToFinalizeRequestResult(data: any) {
  const result: FinalizeRequestResult = {
    id: data[0],
  };
  return result;
}
