import type { Database } from "better-sqlite3";

export type FinalizeRequestData = {
  state: string | null;
  reason: string | null;
  now: string | null;
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
	UPDATE pantry_requests SET state = ?, reason = ?, claim_token = NULL, updated_at = ?,
	  uncertain_since = CASE WHEN ? = 'uncertain' THEN ? END,
	  resolved_at = CASE WHEN ? = 'delivered' THEN ? END
	WHERE id = ? AND state = 'sending' AND claim_token = ? RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.state,
      data.reason,
      data.now,
      data.state,
      data.now,
      data.state,
      data.now,
      params.id,
      params.claim_token,
    ]);

  return rows.map((data) => mapArrayToFinalizeRequestResult(data));
}

function mapArrayToFinalizeRequestResult(data: any) {
  const result: FinalizeRequestResult = {
    id: data[0],
  };
  return result;
}
