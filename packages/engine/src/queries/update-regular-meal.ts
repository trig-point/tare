import type { Database } from "better-sqlite3";

export type UpdateRegularMealData = {
  restaurant: string | null;
  baseline: string;
};

export type UpdateRegularMealParams = {
  user_id: number;
  id: number;
};

export type UpdateRegularMealResult = {
  food_id: number;
};

export function updateRegularMeal(
  db: Database,
  data: UpdateRegularMealData,
  params: UpdateRegularMealParams,
): UpdateRegularMealResult[] {
  const sql = `
	UPDATE regular_meals SET restaurant = ?, baseline = ?
	WHERE user_id = ? AND food_id = ? AND archived_at IS NULL RETURNING food_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.restaurant, data.baseline, params.user_id, params.id]);

  return rows.map((data) => mapArrayToUpdateRegularMealResult(data));
}

function mapArrayToUpdateRegularMealResult(data: any) {
  const result: UpdateRegularMealResult = {
    food_id: data[0],
  };
  return result;
}
