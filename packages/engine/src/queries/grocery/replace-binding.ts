import type { Database } from "better-sqlite3";

export type ReplaceBindingData = {
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  change_token: string;
};

export type ReplaceBindingParams = {
  user_id: number;
  generation: number;
  reference_id: number;
  expected_token: string;
  expected_status: string;
};

export type ReplaceBindingResult = {
  change_token: string;
};

export function replaceBinding(
  db: Database,
  data: ReplaceBindingData,
  params: ReplaceBindingParams,
): ReplaceBindingResult[] {
  const sql = `
	UPDATE pantry_bindings SET product_id = ?, stock_unit_id = ?, quantity_per_serving = ?, status = 'valid', change_token = ?
	WHERE user_id = ? AND generation = ? AND reference_kind = 'food' AND reference_id = ? AND change_token = ? AND status = ?
	RETURNING change_token;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.product_id,
      data.stock_unit_id,
      data.quantity_per_serving,
      data.change_token,
      params.user_id,
      params.generation,
      params.reference_id,
      params.expected_token,
      params.expected_status,
    ]);

  return rows.map((data) => mapArrayToReplaceBindingResult(data));
}

function mapArrayToReplaceBindingResult(data: any) {
  const result: ReplaceBindingResult = {
    change_token: data[0],
  };
  return result;
}
