import type { Database } from "better-sqlite3";

export type UpdatePlannedItemData = {
  order_meal_id: number | null;
  food_id: number | null;
  servings: number | null;
  updated_at: string;
};

export type UpdatePlannedItemParams = {
  user_id: number;
  day: string;
  template_id: number;
  position: number;
  id: number;
  revision: number;
};

export type UpdatePlannedItemResult = {
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

export function updatePlannedItem(
  db: Database,
  data: UpdatePlannedItemData,
  params: UpdatePlannedItemParams,
): UpdatePlannedItemResult[] {
  const sql = `
	UPDATE planned_items SET order_meal_id = ?, food_id = ?, servings = ?,
	revision = revision + 1, updated_at = ?
	WHERE user_id = ? AND day = ? AND template_id = ? AND position = ?
	AND state = 'planned' AND id = ? AND revision = ?
	RETURNING *;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.order_meal_id,
      data.food_id,
      data.servings,
      data.updated_at,
      params.user_id,
      params.day,
      params.template_id,
      params.position,
      params.id,
      params.revision,
    ]);

  return rows.map((data) => mapArrayToUpdatePlannedItemResult(data));
}

function mapArrayToUpdatePlannedItemResult(data: any) {
  const result: UpdatePlannedItemResult = {
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
