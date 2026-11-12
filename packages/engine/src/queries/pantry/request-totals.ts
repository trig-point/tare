import type { Database } from "better-sqlite3";

export type RequestTotalsParams = {
  user_id: number;
  generation: number;
};

export type RequestTotalsResult = {
  product_id: number;
  stock_unit_id: number;
  pending: number | null;
  sending: number | null;
  uncertain: number | null;
};

export function requestTotals(
  db: Database,
  params: RequestTotalsParams,
): RequestTotalsResult[] {
  const sql = `
	SELECT product_id, stock_unit_id,
	  sum(CASE WHEN state = 'pending' THEN quantity ELSE 0.0 END) AS pending,
	  sum(CASE WHEN state = 'sending' THEN quantity ELSE 0.0 END) AS sending,
	  sum(CASE WHEN state = 'uncertain' THEN quantity ELSE 0.0 END) AS uncertain
	FROM pantry_requests WHERE user_id = ? AND generation = ? AND state IN ('pending', 'sending', 'uncertain')
	GROUP BY product_id, stock_unit_id ORDER BY product_id, stock_unit_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.generation]);

  return rows.map((data) => mapArrayToRequestTotalsResult(data));
}

function mapArrayToRequestTotalsResult(data: any) {
  const result: RequestTotalsResult = {
    product_id: data[0],
    stock_unit_id: data[1],
    pending: data[2],
    sending: data[3],
    uncertain: data[4],
  };
  return result;
}
