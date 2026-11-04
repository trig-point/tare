import type { Database } from "better-sqlite3";

export type InsertPlannedItemParams = {
  user_id: number;
  day: string;
  template_id: number | null;
  position: number | null;
  order_meal_id: number | null;
  food_id: number | null;
  servings: number | null;
  created_at: string;
  updated_at: string;
};

export type InsertPlannedItemResult = {
  id: number;
  user_id: number;
  day: string;
  template_id: number | null;
  position: number | null;
  order_meal_id: number | null;
  food_id: number | null;
  servings: number | null;
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function insertPlannedItem(
  db: Database,
  params: InsertPlannedItemParams,
): InsertPlannedItemResult | null {
  const sql = `
	INSERT INTO planned_items (user_id, day, template_id, position, order_meal_id, food_id, servings, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.template_id,
      params.position,
      params.order_meal_id,
      params.food_id,
      params.servings,
      params.created_at,
      params.updated_at,
    ]);

  return res ? mapArrayToInsertPlannedItemResult(res) : null;
}

function mapArrayToInsertPlannedItemResult(data: any) {
  const result: InsertPlannedItemResult = {
    id: data[0],
    user_id: data[1],
    day: data[2],
    template_id: data[3],
    position: data[4],
    order_meal_id: data[5],
    food_id: data[6],
    servings: data[7],
    state: data[8],
    revision: data[9],
    created_at: data[10],
    updated_at: data[11],
  };
  return result;
}
