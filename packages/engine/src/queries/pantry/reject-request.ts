import type { Database } from "better-sqlite3";

export type RejectRequestData = {
  reason: string | null;
  now: string | null;
};

export type RejectRequestParams = {
  id: string;
  user_id: number;
  generation: number;
  product_id: number;
  stock_unit_id: number;
};

export type RejectRequestResult = {
  id: string;
  attempt_count: number;
};

export function rejectRequest(
  db: Database,
  data: RejectRequestData,
  params: RejectRequestParams,
): RejectRequestResult[] {
  const sql = `
	UPDATE pantry_requests SET state = 'rejected', reason = ?, attempt_count = attempt_count + 1, updated_at = ?
	WHERE id = ? AND state = 'pending' AND user_id = ? AND generation = ? AND product_id = ? AND stock_unit_id = ?
	RETURNING id, attempt_count;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.reason,
      data.now,
      params.id,
      params.user_id,
      params.generation,
      params.product_id,
      params.stock_unit_id,
    ]);

  return rows.map((data) => mapArrayToRejectRequestResult(data));
}

function mapArrayToRejectRequestResult(data: any) {
  const result: RejectRequestResult = {
    id: data[0],
    attempt_count: data[1],
  };
  return result;
}
