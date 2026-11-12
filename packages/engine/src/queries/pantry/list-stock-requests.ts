import type { Database } from "better-sqlite3";

export type ListStockRequestsParams = {
  user_id: number;
  generation: number;
  fetch_started_at: string;
};

export type ListStockRequestsResult = {
  product_id: number;
  stock_unit_id: number;
  quantity: number;
  state: string;
  sent_at: string | null;
  confirmed_at: string | null;
};

export function listStockRequests(
  db: Database,
  params: ListStockRequestsParams,
): ListStockRequestsResult[] {
  const sql = `
	SELECT pantry_requests.product_id, pantry_requests.stock_unit_id, pantry_requests.quantity, pantry_requests.state,
	  (SELECT started_at FROM pantry_attempts WHERE request_id = pantry_requests.id AND number = pantry_requests.attempt_count AND outcome = 'sending') AS sent_at,
	  (SELECT finished_at FROM pantry_attempts WHERE request_id = pantry_requests.id AND outcome = 'confirmed') AS confirmed_at
	FROM pantry_requests
	WHERE pantry_requests.user_id = ? AND pantry_requests.generation = ?
	  AND (pantry_requests.state IN ('pending', 'sending', 'uncertain', 'rejected')
	    OR (pantry_requests.state = 'delivered' AND NOT EXISTS (
	      SELECT 1 FROM pantry_attempts WHERE request_id = pantry_requests.id AND outcome = 'confirmed'
	        AND strftime('%Y-%m-%dT%H:%M:%fZ', finished_at, '+0 seconds') IS finished_at AND finished_at < ?)))
	ORDER BY pantry_requests.product_id, pantry_requests.id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.generation, params.fetch_started_at]);

  return rows.map((data) => mapArrayToListStockRequestsResult(data));
}

function mapArrayToListStockRequestsResult(data: any) {
  const result: ListStockRequestsResult = {
    product_id: data[0],
    stock_unit_id: data[1],
    quantity: data[2],
    state: data[3],
    sent_at: data[4],
    confirmed_at: data[5],
  };
  return result;
}
