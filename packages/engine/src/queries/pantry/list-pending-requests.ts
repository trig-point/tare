import type { Database } from "better-sqlite3";

export type ListPendingRequestsParams = {
  user_id: number;
  generation: number;
};

export type ListPendingRequestsResult = {
  id: string;
  product_id: number;
  stock_unit_id: number;
};

export function listPendingRequests(
  db: Database,
  params: ListPendingRequestsParams,
): ListPendingRequestsResult[] {
  const sql = `
	SELECT id, product_id, stock_unit_id FROM pantry_requests WHERE user_id = ? AND generation = ? AND state = 'pending' ORDER BY created_at, id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.generation]);

  return rows.map((data) => mapArrayToListPendingRequestsResult(data));
}

function mapArrayToListPendingRequestsResult(data: any) {
  const result: ListPendingRequestsResult = {
    id: data[0],
    product_id: data[1],
    stock_unit_id: data[2],
  };
  return result;
}
