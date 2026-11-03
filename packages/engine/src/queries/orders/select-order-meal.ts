import type { Database } from "better-sqlite3";

export type SelectOrderMealParams = {
  user_id: number;
  id: number;
};

export type SelectOrderMealResult = {
  id: number;
  user_id: number;
  order_id: number;
  name: string;
  chef: string | null;
  quantity: number;
  revision: number;
  updated_at: string;
};

export function selectOrderMeal(
  db: Database,
  params: SelectOrderMealParams,
): SelectOrderMealResult | null {
  const sql = `
	SELECT * FROM order_meals WHERE user_id = ? AND id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectOrderMealResult(res) : null;
}

function mapArrayToSelectOrderMealResult(data: any) {
  const result: SelectOrderMealResult = {
    id: data[0],
    user_id: data[1],
    order_id: data[2],
    name: data[3],
    chef: data[4],
    quantity: data[5],
    revision: data[6],
    updated_at: data[7],
  };
  return result;
}
