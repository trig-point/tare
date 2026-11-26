import type { Database } from "better-sqlite3";

export type SelectRegularMealFoodParams = {
  user_id: number;
  id: number;
};

export type SelectRegularMealFoodResult = {
  archived_at: string | null;
  restaurant: string | null;
  baseline: string;
};

export function selectRegularMealFood(
  db: Database,
  params: SelectRegularMealFoodParams,
): SelectRegularMealFoodResult | null {
  const sql = `
	SELECT archived_at, restaurant, baseline FROM regular_meals WHERE user_id = ? AND food_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectRegularMealFoodResult(res) : null;
}

function mapArrayToSelectRegularMealFoodResult(data: any) {
  const result: SelectRegularMealFoodResult = {
    archived_at: data[0],
    restaurant: data[1],
    baseline: data[2],
  };
  return result;
}
