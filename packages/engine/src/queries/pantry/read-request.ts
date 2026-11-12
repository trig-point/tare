import type { Database } from "better-sqlite3";

export type ReadRequestParams = {
  id: string;
};

export type ReadRequestResult = {
  id: string;
  user_id: number;
  generation: number;
  client_id: string;
  intake_id: number | null;
  reference_kind: string;
  reference_id: number;
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  quantity: number;
  state: string;
  reason: string | null;
  attempt_count: number;
  claim_token: string | null;
  edited_servings: number | null;
  detached_intake: string | null;
  created_at: string;
  uncertain_since: string | null;
  updated_at: string | null;
  resolved_at: string | null;
};

export function readRequest(
  db: Database,
  params: ReadRequestParams,
): ReadRequestResult[] {
  const sql = `
	SELECT * FROM pantry_requests WHERE id = ?;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.id]);

  return rows.map((data) => mapArrayToReadRequestResult(data));
}

function mapArrayToReadRequestResult(data: any) {
  const result: ReadRequestResult = {
    id: data[0],
    user_id: data[1],
    generation: data[2],
    client_id: data[3],
    intake_id: data[4],
    reference_kind: data[5],
    reference_id: data[6],
    product_id: data[7],
    stock_unit_id: data[8],
    quantity_per_serving: data[9],
    quantity: data[10],
    state: data[11],
    reason: data[12],
    attempt_count: data[13],
    claim_token: data[14],
    edited_servings: data[15],
    detached_intake: data[16],
    created_at: data[17],
    uncertain_since: data[18],
    updated_at: data[19],
    resolved_at: data[20],
  };
  return result;
}
