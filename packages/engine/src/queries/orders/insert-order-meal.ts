import type { Database } from "better-sqlite3";

export type InsertOrderMealParams = {
  user_id: number;
  order_id: number;
  name: string;
  chef: string | null;
  quantity: number;
  updated_at: string;
};

export type InsertOrderMealResult = {
  id: number;
  user_id: number;
  order_id: number;
  name: string;
  chef: string | null;
  quantity: number;
  revision: number;
  updated_at: string;
};

export function insertOrderMeal(
  db: Database,
  params: InsertOrderMealParams,
): InsertOrderMealResult | null {
  const sql = `
	INSERT INTO order_meals (user_id, order_id, name, chef, quantity, updated_at)
	VALUES (?, ?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.order_id,
      params.name,
      params.chef,
      params.quantity,
      params.updated_at,
    ]);

  return res ? mapArrayToInsertOrderMealResult(res) : null;
}

function mapArrayToInsertOrderMealResult(data: any) {
  const result: InsertOrderMealResult = {
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
