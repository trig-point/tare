import type { Database } from "better-sqlite3";

export type InsertMealReceiptParams = {
  user_id: number;
  client_id: string;
  part_key: string;
  request_hash: string;
  part_count: number;
  created_at: string;
};

export type InsertMealReceiptResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertMealReceipt(
  db: Database,
  params: InsertMealReceiptParams,
): InsertMealReceiptResult {
  const sql = `
	INSERT INTO meal_receipts (user_id, client_id, part_key, request_hash, part_count, created_at)
	VALUES (?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.client_id,
      params.part_key,
      params.request_hash,
      params.part_count,
      params.created_at,
    ]) as InsertMealReceiptResult;
}
