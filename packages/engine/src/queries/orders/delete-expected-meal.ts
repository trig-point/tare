import type { Database } from "better-sqlite3";

export type DeleteExpectedMealParams = {
  user_id: number;
  id: number;
};

export type DeleteExpectedMealResult = {
  changes: number;
};

export function deleteExpectedMeal(
  db: Database,
  params: DeleteExpectedMealParams,
): DeleteExpectedMealResult {
  const sql = `
	DELETE FROM order_meals WHERE user_id = ? AND id = ?
	AND NOT EXISTS (SELECT 1 FROM meal_actions WHERE user_id = ? AND order_meal_id = ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.id,
      params.user_id,
      params.id,
    ]) as DeleteExpectedMealResult;
}
