import type { Database } from "better-sqlite3";

export type SelectMealActionParams = {
  user_id: number;
  mutation_id: string;
};

export type SelectMealActionResult = {
  user_id: number;
  mutation_id: string;
  order_meal_id: number;
  action: string;
  intake_entry_id: number;
  result: string;
  created_at: string;
};

export function selectMealAction(
  db: Database,
  params: SelectMealActionParams,
): SelectMealActionResult | null {
  const sql = `
	SELECT * FROM meal_actions
	WHERE user_id = ? AND mutation_id = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.mutation_id]);

  return res ? mapArrayToSelectMealActionResult(res) : null;
}

function mapArrayToSelectMealActionResult(data: any) {
  const result: SelectMealActionResult = {
    user_id: data[0],
    mutation_id: data[1],
    order_meal_id: data[2],
    action: data[3],
    intake_entry_id: data[4],
    result: data[5],
    created_at: data[6],
  };
  return result;
}
