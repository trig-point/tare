import type { Database } from "better-sqlite3";

export type InsertMealActionParams = {
  user_id: number | null;
  mutation_id: string;
  order_meal_id: number;
  action: string;
  intake_entry_id: number;
  result: string;
  created_at: string;
};

export type InsertMealActionResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertMealAction(
  db: Database,
  params: InsertMealActionParams,
): InsertMealActionResult {
  const sql = `
	INSERT INTO meal_actions (user_id, mutation_id, order_meal_id, action, intake_entry_id, result, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.mutation_id,
      params.order_meal_id,
      params.action,
      params.intake_entry_id,
      params.result,
      params.created_at,
    ]) as InsertMealActionResult;
}
