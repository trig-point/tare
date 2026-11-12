import type { Database } from "better-sqlite3";

export type InsertFoodReceiptParams = {
  user_id: number | null;
  mutation_id: string;
  request_hash: string;
  food_id: number;
  created_at: string;
};

export type InsertFoodReceiptResult = {
  user_id: number;
  mutation_id: string;
  request_hash: string;
  food_id: number;
  created_at: string;
};

export function insertFoodReceipt(
  db: Database,
  params: InsertFoodReceiptParams,
): InsertFoodReceiptResult | null {
  const sql = `
	INSERT INTO food_receipts (user_id, mutation_id, request_hash, food_id, created_at)
	VALUES (?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.mutation_id,
      params.request_hash,
      params.food_id,
      params.created_at,
    ]);

  return res ? mapArrayToInsertFoodReceiptResult(res) : null;
}

function mapArrayToInsertFoodReceiptResult(data: any) {
  const result: InsertFoodReceiptResult = {
    user_id: data[0],
    mutation_id: data[1],
    request_hash: data[2],
    food_id: data[3],
    created_at: data[4],
  };
  return result;
}
