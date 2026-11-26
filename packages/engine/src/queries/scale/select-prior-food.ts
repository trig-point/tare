import type { Database } from "better-sqlite3";

export type SelectPriorFoodParams = {
  user_id: number;
  day: string;
  measured_at: string;
};

export type SelectPriorFoodResult = {
  created_at: string;
};

export function selectPriorFood(
  db: Database,
  params: SelectPriorFoodParams,
): SelectPriorFoodResult[] {
  const sql = `
	SELECT created_at FROM first_food_times
	WHERE user_id = ? AND day = ? AND created_at < ?;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.day, params.measured_at]);

  return rows.map((data) => mapArrayToSelectPriorFoodResult(data));
}

function mapArrayToSelectPriorFoodResult(data: any) {
  const result: SelectPriorFoodResult = {
    created_at: data[0],
  };
  return result;
}
