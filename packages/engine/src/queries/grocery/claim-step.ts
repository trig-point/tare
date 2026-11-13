import type { Database } from "better-sqlite3";

export type ClaimStepData = {
  claim_token: string | null;
  product_id: number | null;
  stock_log_max: number | null;
  now: string;
};

export type ClaimStepParams = {
  request_id: number;
  number: number;
};

export type ClaimStepResult = {
  request_id: number;
  number: number;
  kind: string;
  claim_token: string | null;
};

export function claimStep(
  db: Database,
  data: ClaimStepData,
  params: ClaimStepParams,
): ClaimStepResult[] {
  const sql = `
	UPDATE grocery_steps SET state = 'sending', reason = NULL, claim_token = ?, product_id = ?, stock_log_max = ?, updated_at = ?
	WHERE request_id = ? AND number = ? AND state = 'pending'
	  AND EXISTS (SELECT 1 FROM grocery_requests WHERE id = ? AND state = 'open')
	  AND NOT EXISTS (SELECT 1 FROM grocery_steps AS earlier WHERE earlier.request_id = ? AND earlier.number < ? AND earlier.state NOT IN ('confirmed', 'adopted'))
	RETURNING request_id, number, kind, claim_token;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.claim_token,
      data.product_id,
      data.stock_log_max,
      data.now,
      params.request_id,
      params.number,
      params.request_id,
      params.request_id,
      params.number,
    ]);

  return rows.map((data) => mapArrayToClaimStepResult(data));
}

function mapArrayToClaimStepResult(data: any) {
  const result: ClaimStepResult = {
    request_id: data[0],
    number: data[1],
    kind: data[2],
    claim_token: data[3],
  };
  return result;
}
