import type { Database } from "better-sqlite3";

export type ClaimRequestData = {
  claim_token: string | null;
  now: string | null;
};

export type ClaimRequestParams = {
  id: string;
  user_id: number;
  generation: number;
  product_id: number;
  stock_unit_id: number;
};

export type ClaimRequestResult = {
  id: string;
  user_id: number;
  generation: number;
  product_id: number;
  stock_unit_id: number;
  quantity: number;
  attempt_count: number;
  claim_token: string | null;
};

export function claimRequest(
  db: Database,
  data: ClaimRequestData,
  params: ClaimRequestParams,
): ClaimRequestResult[] {
  const sql = `
	UPDATE pantry_requests SET state = 'sending', attempt_count = attempt_count + 1, claim_token = ?, updated_at = ?
	WHERE id = ? AND state = 'pending' AND user_id = ? AND generation = ? AND product_id = ? AND stock_unit_id = ?
	RETURNING id, user_id, generation, product_id, stock_unit_id, quantity, attempt_count, claim_token;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.claim_token,
      data.now,
      params.id,
      params.user_id,
      params.generation,
      params.product_id,
      params.stock_unit_id,
    ]);

  return rows.map((data) => mapArrayToClaimRequestResult(data));
}

function mapArrayToClaimRequestResult(data: any) {
  const result: ClaimRequestResult = {
    id: data[0],
    user_id: data[1],
    generation: data[2],
    product_id: data[3],
    stock_unit_id: data[4],
    quantity: data[5],
    attempt_count: data[6],
    claim_token: data[7],
  };
  return result;
}
