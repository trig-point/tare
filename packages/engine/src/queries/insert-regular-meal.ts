import type { Database } from "better-sqlite3";

export type InsertRegularMealParams = {
  user_id: number | null;
  food_id: number | null;
  restaurant: string | null;
  baseline: string;
  created_at: string;
};

export type InsertRegularMealResult = {
  food_id: number;
};

export function insertRegularMeal(
  db: Database,
  params: InsertRegularMealParams,
): InsertRegularMealResult | null {
  const sql = `
	INSERT INTO regular_meals (user_id, food_id, restaurant, baseline, created_at)
	VALUES (?, ?, ?, ?, ?) RETURNING food_id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.food_id,
      params.restaurant,
      params.baseline,
      params.created_at,
    ]);

  return res ? mapArrayToInsertRegularMealResult(res) : null;
}

function mapArrayToInsertRegularMealResult(data: any) {
  const result: InsertRegularMealResult = {
    food_id: data[0],
  };
  return result;
}
