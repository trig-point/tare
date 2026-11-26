import type { Database } from "better-sqlite3";

export type SelectMealReceiptByPartKeyParams = {
  user_id: number;
  part_key: string;
};

export type SelectMealReceiptByPartKeyResult = {
  created_at: string;
  part_count: number;
};

export function selectMealReceiptByPartKey(
  db: Database,
  params: SelectMealReceiptByPartKeyParams,
): SelectMealReceiptByPartKeyResult | null {
  const sql = `
	SELECT created_at, part_count FROM meal_receipts WHERE user_id = ? AND part_key = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.part_key]);

  return res ? mapArrayToSelectMealReceiptByPartKeyResult(res) : null;
}

function mapArrayToSelectMealReceiptByPartKeyResult(data: any) {
  const result: SelectMealReceiptByPartKeyResult = {
    created_at: data[0],
    part_count: data[1],
  };
  return result;
}
