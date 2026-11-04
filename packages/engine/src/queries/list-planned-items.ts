import type { Database } from "better-sqlite3";

export type ListPlannedItemsParams = {
  user_id: number;
  day: string;
  template_id: number;
};

export type ListPlannedItemsResult = {
  id: number;
  user_id: number;
  day: string;
  template_id: number;
  position: number | null;
  order_meal_id: number | null;
  food_id: number | null;
  servings: number | null;
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function listPlannedItems(
  db: Database,
  params: ListPlannedItemsParams,
): ListPlannedItemsResult[] {
  const sql = `
	SELECT * FROM planned_items
	WHERE user_id = ? AND day = ? AND template_id = ? AND state = 'planned'
	ORDER BY position;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.day, params.template_id]);

  return rows.map((data) => mapArrayToListPlannedItemsResult(data));
}

function mapArrayToListPlannedItemsResult(data: any) {
  const result: ListPlannedItemsResult = {
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
