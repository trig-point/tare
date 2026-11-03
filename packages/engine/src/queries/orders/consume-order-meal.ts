import type { Database } from "better-sqlite3";

export type ConsumeOrderMealData = {
  updated_at: string;
};

export type ConsumeOrderMealParams = {
  user_id: number;
  id: number;
  revision: number;
};

export type ConsumeOrderMealResult = {
  id: number;
  quantity: number;
  revision: number;
};

export function consumeOrderMeal(
  db: Database,
  data: ConsumeOrderMealData,
  params: ConsumeOrderMealParams,
): ConsumeOrderMealResult[] {
  const sql = `
	UPDATE order_meals SET quantity = quantity - 1, revision = revision + 1, updated_at = ?
	WHERE user_id = ? AND id = ? AND revision = ? AND quantity >= 1
	RETURNING id, quantity, revision;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.updated_at, params.user_id, params.id, params.revision]);

  return rows.map((data) => mapArrayToConsumeOrderMealResult(data));
}

function mapArrayToConsumeOrderMealResult(data: any) {
  const result: ConsumeOrderMealResult = {
    id: data[0],
    quantity: data[1],
    revision: data[2],
  };
  return result;
}
