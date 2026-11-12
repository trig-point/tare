import type { Database } from "better-sqlite3";

export type InsertProductParams = {
  user_id: number | null;
  generation: number | null;
  product_id: number | null;
  product: string;
};

export type InsertProductResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertProduct(
  db: Database,
  params: InsertProductParams,
): InsertProductResult {
  const sql = `
	INSERT INTO pantry_products (user_id, generation, product_id, product) VALUES (?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.generation,
      params.product_id,
      params.product,
    ]) as InsertProductResult;
}
