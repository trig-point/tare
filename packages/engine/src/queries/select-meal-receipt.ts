import type { Database } from "better-sqlite3";

export type SelectMealReceiptParams = {
  user_id: number;
  client_id: string;
};

export type SelectMealReceiptResult = {
  part_key: string;
  request_hash: string;
  part_count: number;
};

export function selectMealReceipt(
  db: Database,
  params: SelectMealReceiptParams,
): SelectMealReceiptResult | null {
  const sql = `
	SELECT part_key, request_hash, part_count FROM meal_receipts
	WHERE user_id = ? AND client_id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.client_id]);

  return res ? mapArrayToSelectMealReceiptResult(res) : null;
}

function mapArrayToSelectMealReceiptResult(data: any) {
  const result: SelectMealReceiptResult = {
    part_key: data[0],
    request_hash: data[1],
    part_count: data[2],
  };
  return result;
}
