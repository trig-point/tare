import type { Database } from "better-sqlite3";

export type SaveBindingParams = {
  user_id: number | null;
  generation: number | null;
  reference_kind: string;
  reference_id: number | null;
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  change_token: string;
};

export type SaveBindingResult = {
  changes: number;
  lastInsertRowid: number;
};

export function saveBinding(
  db: Database,
  params: SaveBindingParams,
): SaveBindingResult {
  const sql = `
	INSERT INTO pantry_bindings (user_id, generation, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, status, change_token)
	VALUES (?, ?, ?, ?, ?, ?, ?, 'valid', ?)
	ON CONFLICT(user_id, generation, reference_kind, reference_id) DO UPDATE SET stock_unit_id = excluded.stock_unit_id, quantity_per_serving = excluded.quantity_per_serving, status = 'valid', change_token = excluded.change_token WHERE product_id = excluded.product_id;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.generation,
      params.reference_kind,
      params.reference_id,
      params.product_id,
      params.stock_unit_id,
      params.quantity_per_serving,
      params.change_token,
    ]) as SaveBindingResult;
}
