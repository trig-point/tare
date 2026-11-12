import type { Database } from "better-sqlite3";

export type SelectFoodReceiptParams = {
  user_id: number;
  mutation_id: string;
};

export type SelectFoodReceiptResult = {
  user_id: number;
  mutation_id: string;
  request_hash: string;
  food_id: number;
  created_at: string;
};

export function selectFoodReceipt(
  db: Database,
  params: SelectFoodReceiptParams,
): SelectFoodReceiptResult | null {
  const sql = `
	SELECT * FROM food_receipts WHERE user_id = ? AND mutation_id = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.mutation_id]);

  return res ? mapArrayToSelectFoodReceiptResult(res) : null;
}

function mapArrayToSelectFoodReceiptResult(data: any) {
  const result: SelectFoodReceiptResult = {
    user_id: data[0],
    mutation_id: data[1],
    request_hash: data[2],
    food_id: data[3],
    created_at: data[4],
  };
  return result;
}
