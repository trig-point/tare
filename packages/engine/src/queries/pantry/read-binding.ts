import type { Database } from "better-sqlite3";

export type ReadBindingParams = {
  user_id: number;
  generation: number;
  reference_kind: string;
  reference_id: number;
};

export type ReadBindingResult = {
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  status: string;
};

export function readBinding(
  db: Database,
  params: ReadBindingParams,
): ReadBindingResult[] {
  const sql = `
	SELECT product_id, stock_unit_id, quantity_per_serving, status FROM pantry_bindings WHERE user_id = ? AND generation = ? AND reference_kind = ? AND reference_id = ?;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      params.user_id,
      params.generation,
      params.reference_kind,
      params.reference_id,
    ]);

  return rows.map((data) => mapArrayToReadBindingResult(data));
}

function mapArrayToReadBindingResult(data: any) {
  const result: ReadBindingResult = {
    product_id: data[0],
    stock_unit_id: data[1],
    quantity_per_serving: data[2],
    status: data[3],
  };
  return result;
}
