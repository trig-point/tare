import type { Database } from "better-sqlite3";

export type ListMealCandidatesParams = {
  user_id: number;
};

export type ListMealCandidatesResult = {
  id: number;
  order_id: number;
  name: string;
  chef: string | null;
  quantity: number;
  revision: number;
  delivery_date: string;
  delivered_at: string | null;
};

export function listMealCandidates(
  db: Database,
  params: ListMealCandidatesParams,
): ListMealCandidatesResult[] {
  const sql = `
	SELECT order_meals.id, order_meals.order_id, order_meals.name, order_meals.chef,
	order_meals.quantity, order_meals.revision, orders.delivery_date, orders.delivered_at
	FROM order_meals JOIN orders ON orders.user_id = order_meals.user_id AND orders.id = order_meals.order_id
	WHERE order_meals.user_id = ? AND order_meals.quantity > 0
	ORDER BY orders.delivery_date, order_meals.id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToListMealCandidatesResult(data));
}

function mapArrayToListMealCandidatesResult(data: any) {
  const result: ListMealCandidatesResult = {
    id: data[0],
    order_id: data[1],
    name: data[2],
    chef: data[3],
    quantity: data[4],
    revision: data[5],
    delivery_date: data[6],
    delivered_at: data[7],
  };
  return result;
}
