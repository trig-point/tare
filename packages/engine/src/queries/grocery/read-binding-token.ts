import type { Database } from "better-sqlite3";

export type ReadBindingTokenParams = {
  user_id: number;
  generation: number;
  reference_id: number;
};

export type ReadBindingTokenResult = {
  product_id: number;
  status: string;
  change_token: string;
};

export function readBindingToken(
  db: Database,
  params: ReadBindingTokenParams,
): ReadBindingTokenResult | null {
  const sql = `
	SELECT product_id, status, change_token FROM pantry_bindings WHERE user_id = ? AND generation = ? AND reference_kind = 'food' AND reference_id = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.generation, params.reference_id]);

  return res ? mapArrayToReadBindingTokenResult(res) : null;
}

function mapArrayToReadBindingTokenResult(data: any) {
  const result: ReadBindingTokenResult = {
    product_id: data[0],
    status: data[1],
    change_token: data[2],
  };
  return result;
}
