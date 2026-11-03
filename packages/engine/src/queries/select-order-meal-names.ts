import type { Database } from "better-sqlite3";

export type SelectOrderMealNamesParams = {
  user_id: number;
};

export type SelectOrderMealNamesResult = {
  service: string;
  name: string;
  chef: string | null;
};

export function selectOrderMealNames(
  db: Database,
  params: SelectOrderMealNamesParams,
): SelectOrderMealNamesResult[] {
  const sql = `
	SELECT orders.service, order_meals.name, order_meals.chef
	FROM order_meals JOIN orders ON orders.user_id = order_meals.user_id AND orders.id = order_meals.order_id
	WHERE order_meals.user_id = ?
	ORDER BY order_meals.id DESC;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectOrderMealNamesResult(data));
}

function mapArrayToSelectOrderMealNamesResult(data: any) {
  const result: SelectOrderMealNamesResult = {
    service: data[0],
    name: data[1],
    chef: data[2],
  };
  return result;
}
