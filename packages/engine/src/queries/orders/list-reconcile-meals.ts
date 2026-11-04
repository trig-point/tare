import type { Database } from "better-sqlite3";

export type ListReconcileMealsParams = {
  user_id: number;
  order_id: number;
};

export type ListReconcileMealsResult = {
  id: number;
  user_id: number;
  order_id: number;
  name: string;
  chef: string | null;
  quantity: number;
  revision: number;
  updated_at: string;
  has_actions: number;
  has_consumption: number;
};

export function listReconcileMeals(
  db: Database,
  params: ListReconcileMealsParams,
): ListReconcileMealsResult[] {
  const sql = `
	SELECT order_meals.*, EXISTS (SELECT 1 FROM meal_actions
	WHERE meal_actions.user_id = order_meals.user_id AND order_meal_id = order_meals.id)
	OR EXISTS (SELECT 1 FROM planned_items
	WHERE planned_items.user_id = order_meals.user_id AND order_meal_id = order_meals.id) AS has_actions,
	EXISTS (SELECT 1 FROM meal_actions
	WHERE meal_actions.user_id = order_meals.user_id AND order_meal_id = order_meals.id) AS has_consumption
	FROM order_meals WHERE user_id = ? AND order_id = ? ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.order_id]);

  return rows.map((data) => mapArrayToListReconcileMealsResult(data));
}

function mapArrayToListReconcileMealsResult(data: any) {
  const result: ListReconcileMealsResult = {
    id: data[0],
    user_id: data[1],
    order_id: data[2],
    name: data[3],
    chef: data[4],
    quantity: data[5],
    revision: data[6],
    updated_at: data[7],
    has_actions: data[8],
    has_consumption: data[9],
  };
  return result;
}
