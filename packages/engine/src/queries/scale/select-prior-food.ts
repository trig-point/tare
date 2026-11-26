import type { Database } from "better-sqlite3";

export type SelectPriorFoodParams = {
  user_id: number;
  day: string;
  measured_at: string;
  start: string;
  end: string;
};

export type SelectPriorFoodResult = {
  created_at: string;
};

export function selectPriorFood(
  db: Database,
  params: SelectPriorFoodParams,
): SelectPriorFoodResult | null {
  const sql = `
	SELECT created_at FROM first_food_times
	WHERE user_id = ? AND day = ? AND created_at < ?
	UNION ALL
	SELECT created_at FROM legacy_food_times
	WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?
	  AND created_at < ?
	LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.measured_at,
      params.user_id,
      params.start,
      params.end,
      params.measured_at,
    ]);

  return res ? mapArrayToSelectPriorFoodResult(res) : null;
}

function mapArrayToSelectPriorFoodResult(data: any) {
  const result: SelectPriorFoodResult = {
    created_at: data[0],
  };
  return result;
}
