import type { Database } from "better-sqlite3";

export type UpdateOrderMealData = {
  name: string;
  chef: string | null;
  quantity: number;
  updated_at: string;
};

export type UpdateOrderMealParams = {
  user_id: number;
  id: number;
};

export type UpdateOrderMealResult = {
  id: number;
  user_id: number;
  order_id: number;
  name: string;
  chef: string | null;
  quantity: number;
  revision: number;
  updated_at: string;
};

export function updateOrderMeal(
  db: Database,
  data: UpdateOrderMealData,
  params: UpdateOrderMealParams,
): UpdateOrderMealResult | null {
  const sql = `
	UPDATE order_meals SET name = ?, chef = ?, quantity = ?,
	revision = revision + 1, updated_at = ?
	WHERE user_id = ? AND id = ? RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      data.name,
      data.chef,
      data.quantity,
      data.updated_at,
      params.user_id,
      params.id,
    ]);

  return res ? mapArrayToUpdateOrderMealResult(res) : null;
}

function mapArrayToUpdateOrderMealResult(data: any) {
  const result: UpdateOrderMealResult = {
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
