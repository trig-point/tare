import type { Database } from "better-sqlite3";

export type ReadBindingParams = {
  user_id: number;
  generation: number;
  reference_kind: string;
  reference_id: number;
};

export type ReadBindingResult = {
  product_id: number;
};

export function readBinding(
  db: Database,
  params: ReadBindingParams,
): ReadBindingResult[] {
  const sql = `
	SELECT product_id FROM pantry_bindings WHERE user_id = ? AND generation = ? AND reference_kind = ? AND reference_id = ?;
	
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
  };
  return result;
}
