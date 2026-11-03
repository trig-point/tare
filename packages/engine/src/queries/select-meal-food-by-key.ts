import type { Database } from "better-sqlite3";

export type SelectMealFoodByKeyParams = {
  user_id: number;
  meal_key: string;
};

export type SelectMealFoodByKeyResult = {
  id: number;
};

export function selectMealFoodByKey(
  db: Database,
  params: SelectMealFoodByKeyParams,
): SelectMealFoodByKeyResult | null {
  const sql = `
	SELECT id FROM foods WHERE user_id = ? AND meal_key = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.meal_key]);

  return res ? mapArrayToSelectMealFoodByKeyResult(res) : null;
}

function mapArrayToSelectMealFoodByKeyResult(data: any) {
  const result: SelectMealFoodByKeyResult = {
    id: data[0],
  };
  return result;
}
