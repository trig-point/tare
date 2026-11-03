import type { Database } from "better-sqlite3";

export type UpdateIntakeData = {
  name: string | null;
  servings: number | null;
  eaten_at: string;
  day: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  kcal_low: number | null;
  kcal_high: number | null;
  provenance: string;
  source: string | null;
  portion_note: string | null;
  updated_at: string;
};

export type UpdateIntakeParams = {
  user_id: number;
  id: number;
};

export type UpdateIntakeResult = {
  user_id: number;
  id: number;
  client_id: string;
  food_id: number | null;
  source_food_id: number | null;
  servings: number | null;
  eaten_at: string;
  day: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  kcal_low: number | null;
  kcal_high: number | null;
  provenance: string;
  source: string | null;
  portion_note: string | null;
  created_at: string;
  updated_at: string;
  name: string | null;
};

export function updateIntake(
  db: Database,
  data: UpdateIntakeData,
  params: UpdateIntakeParams,
): UpdateIntakeResult[] {
  const sql = `
	UPDATE intake_entries SET name = ?, servings = ?, eaten_at = ?, day = ?, kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, kcal_low = ?, kcal_high = ?, provenance = ?, source = ?, portion_note = ?, updated_at = ? WHERE user_id = ? AND id = ? RETURNING *;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.name,
      data.servings,
      data.eaten_at,
      data.day,
      data.kcal,
      data.protein_g,
      data.carbs_g,
      data.fat_g,
      data.fiber_g,
      data.kcal_low,
      data.kcal_high,
      data.provenance,
      data.source,
      data.portion_note,
      data.updated_at,
      params.user_id,
      params.id,
    ]);

  return rows.map((data) => mapArrayToUpdateIntakeResult(data));
}

function mapArrayToUpdateIntakeResult(data: any) {
  const result: UpdateIntakeResult = {
    user_id: data[0],
    id: data[1],
    client_id: data[2],
    food_id: data[3],
    source_food_id: data[4],
    servings: data[5],
    eaten_at: data[6],
    day: data[7],
    kcal: data[8],
    protein_g: data[9],
    carbs_g: data[10],
    fat_g: data[11],
    fiber_g: data[12],
    kcal_low: data[13],
    kcal_high: data[14],
    provenance: data[15],
    source: data[16],
    portion_note: data[17],
    created_at: data[18],
    updated_at: data[19],
    name: data[20],
  };
  return result;
}
