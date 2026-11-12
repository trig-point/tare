import type { Database } from "better-sqlite3";

export type ListBindingsParams = {
  user_id: number;
  generation: number;
};

export type ListBindingsResult = {
  reference_kind: string;
  reference_id: number;
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  status: string;
  change_token: string;
};

export function listBindings(
  db: Database,
  params: ListBindingsParams,
): ListBindingsResult[] {
  const sql = `
	SELECT reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, status, change_token FROM pantry_bindings WHERE user_id = ? AND generation = ? ORDER BY reference_kind, reference_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.generation]);

  return rows.map((data) => mapArrayToListBindingsResult(data));
}

function mapArrayToListBindingsResult(data: any) {
  const result: ListBindingsResult = {
    reference_kind: data[0],
    reference_id: data[1],
    product_id: data[2],
    stock_unit_id: data[3],
    quantity_per_serving: data[4],
    status: data[5],
    change_token: data[6],
  };
  return result;
}
