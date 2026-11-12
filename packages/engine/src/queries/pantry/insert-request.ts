import type { Database } from "better-sqlite3";

export type InsertRequestParams = {
  id: string;
  user_id: number;
  generation: number;
  client_id: string;
  intake_id: number | null;
  reference_kind: string;
  reference_id: number;
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  quantity: number;
  created_at: string;
};

export type InsertRequestResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertRequest(
  db: Database,
  params: InsertRequestParams,
): InsertRequestResult {
  const sql = `
	INSERT INTO pantry_requests (id, user_id, generation, client_id, intake_id, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, quantity, state, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.id,
      params.user_id,
      params.generation,
      params.client_id,
      params.intake_id,
      params.reference_kind,
      params.reference_id,
      params.product_id,
      params.stock_unit_id,
      params.quantity_per_serving,
      params.quantity,
      params.created_at,
    ]) as InsertRequestResult;
}
