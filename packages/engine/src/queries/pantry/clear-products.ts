import type { Database } from "better-sqlite3";

export type ClearProductsResult = {
  changes: number;
};

export function clearProducts(db: Database): ClearProductsResult {
  const sql = `
	DELETE FROM pantry_products;
	
	`;
  return db.prepare(sql).run() as ClearProductsResult;
}
