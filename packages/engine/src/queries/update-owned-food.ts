import type { Database } from "better-sqlite3";

export type UpdateOwnedFoodData = {
  name: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  kcal_low: number | null;
  kcal_high: number | null;
  provenance: string;
  source: string | null;
};

export type UpdateOwnedFoodParams = {
  user_id: number;
  id: number;
};

export type UpdateOwnedFoodResult = {
  id: number;
  name: string;
  serving_size: number | null;
  serving_unit: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  kcal_low: number | null;
  kcal_high: number | null;
  provenance: string;
  source: string | null;
  source_food_id: number | null;
};

export function updateOwnedFood(
  db: Database,
  data: UpdateOwnedFoodData,
  params: UpdateOwnedFoodParams,
): UpdateOwnedFoodResult[] {
  const sql = `
	UPDATE foods SET name = ?,
	  kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
	  kcal_low = ?, kcal_high = ?, provenance = ?, source = ?
	WHERE user_id = ? AND id = ? RETURNING id, name, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g,
	  fiber_g, kcal_low, kcal_high, provenance, source, source_food_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.name,
      data.kcal,
      data.protein_g,
      data.carbs_g,
      data.fat_g,
      data.fiber_g,
      data.kcal_low,
      data.kcal_high,
      data.provenance,
      data.source,
      params.user_id,
      params.id,
    ]);

  return rows.map((data) => mapArrayToUpdateOwnedFoodResult(data));
}

function mapArrayToUpdateOwnedFoodResult(data: any) {
  const result: UpdateOwnedFoodResult = {
    id: data[0],
    name: data[1],
    serving_size: data[2],
    serving_unit: data[3],
    kcal: data[4],
    protein_g: data[5],
    carbs_g: data[6],
    fat_g: data[7],
    fiber_g: data[8],
    kcal_low: data[9],
    kcal_high: data[10],
    provenance: data[11],
    source: data[12],
    source_food_id: data[13],
  };
  return result;
}
