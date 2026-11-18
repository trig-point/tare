import type { Database } from "better-sqlite3";

export type SelectRegularMealFoodParams = {
  user_id: number;
  id: number;
};

export type SelectRegularMealFoodResult = {
  food_id: number;
};

export function selectRegularMealFood(
  db: Database,
  params: SelectRegularMealFoodParams,
): SelectRegularMealFoodResult | null {
  const sql = `
	SELECT food_id FROM regular_meals WHERE user_id = ? AND food_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectRegularMealFoodResult(res) : null;
}

function mapArrayToSelectRegularMealFoodResult(data: any) {
  const result: SelectRegularMealFoodResult = {
    food_id: data[0],
  };
  return result;
}
