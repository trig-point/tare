import type { Database } from "better-sqlite3";

export type ListStepsParams = {
  request_id: number;
};

export type ListStepsResult = {
  number: number;
  kind: string;
  state: string;
  reason: string | null;
  product_id: number | null;
  stock_log_max: number | null;
  object_id: number | null;
  transaction_id: string | null;
  updated_at: string;
};

export function listSteps(
  db: Database,
  params: ListStepsParams,
): ListStepsResult[] {
  const sql = `
	SELECT number, kind, state, reason, product_id, stock_log_max, object_id, transaction_id, updated_at FROM grocery_steps WHERE request_id = ? ORDER BY number;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.request_id]);

  return rows.map((data) => mapArrayToListStepsResult(data));
}

function mapArrayToListStepsResult(data: any) {
  const result: ListStepsResult = {
    number: data[0],
    kind: data[1],
    state: data[2],
    reason: data[3],
    product_id: data[4],
    stock_log_max: data[5],
    object_id: data[6],
    transaction_id: data[7],
    updated_at: data[8],
  };
  return result;
}
