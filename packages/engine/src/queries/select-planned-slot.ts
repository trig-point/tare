import type { Database } from "better-sqlite3";

export type SelectPlannedSlotParams = {
  user_id: number;
  day: string;
  template_id: number;
  position: number;
};

export type SelectPlannedSlotResult = {
  id: number;
  user_id: number;
  day: string;
  template_id: number;
  position: number;
  order_meal_id: number | null;
  food_id: number | null;
  servings: number | null;
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function selectPlannedSlot(
  db: Database,
  params: SelectPlannedSlotParams,
): SelectPlannedSlotResult | null {
  const sql = `
	SELECT * FROM planned_items
	WHERE user_id = ? AND day = ? AND template_id = ? AND position = ?
	AND state = 'planned' LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.day, params.template_id, params.position]);

  return res ? mapArrayToSelectPlannedSlotResult(res) : null;
}

function mapArrayToSelectPlannedSlotResult(data: any) {
  const result: SelectPlannedSlotResult = {
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
