import type { Database } from "better-sqlite3";

export type InsertBindingAbsentParams = {
  user_id: number | null;
  generation: number | null;
  reference_id: number | null;
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  change_token: string;
};

export type InsertBindingAbsentResult = {
  change_token: string;
};

export function insertBindingAbsent(
  db: Database,
  params: InsertBindingAbsentParams,
): InsertBindingAbsentResult | null {
  const sql = `
	INSERT INTO pantry_bindings (user_id, generation, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, status, change_token)
	VALUES (?, ?, 'food', ?, ?, ?, ?, 'valid', ?)
	ON CONFLICT DO NOTHING RETURNING change_token;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.generation,
      params.reference_id,
      params.product_id,
      params.stock_unit_id,
      params.quantity_per_serving,
      params.change_token,
    ]);

  return res ? mapArrayToInsertBindingAbsentResult(res) : null;
}

function mapArrayToInsertBindingAbsentResult(data: any) {
  const result: InsertBindingAbsentResult = {
    change_token: data[0],
  };
  return result;
}
