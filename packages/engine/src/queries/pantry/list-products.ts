import type { Database } from "better-sqlite3";

export type ListProductsParams = {
  user_id: number;
  generation: number;
};

export type ListProductsResult = {
  product: string;
};

export function listProducts(
  db: Database,
  params: ListProductsParams,
): ListProductsResult[] {
  const sql = `
	SELECT product FROM pantry_products WHERE user_id = ? AND generation = ? ORDER BY product_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.generation]);

  return rows.map((data) => mapArrayToListProductsResult(data));
}

function mapArrayToListProductsResult(data: any) {
  const result: ListProductsResult = {
    product: data[0],
  };
  return result;
}
