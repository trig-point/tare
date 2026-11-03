import type { Database } from "better-sqlite3";

export type UpdateRegularMealFoodData = {
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
};

export type UpdateRegularMealFoodParams = {
  user_id: number;
  id: number;
};

export type UpdateRegularMealFoodResult = {
  id: number;
};

export function updateRegularMealFood(
  db: Database,
  data: UpdateRegularMealFoodData,
  params: UpdateRegularMealFoodParams,
): UpdateRegularMealFoodResult[] {
  const sql = `
	UPDATE foods SET name = ?, serving_size = ?, serving_unit = ?,
	  kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
	  kcal_low = ?, kcal_high = ?, provenance = ?, source = ?
	WHERE user_id = ? AND id = ? RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.name,
      data.serving_size,
      data.serving_unit,
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

  return rows.map((data) => mapArrayToUpdateRegularMealFoodResult(data));
}

function mapArrayToUpdateRegularMealFoodResult(data: any) {
  const result: UpdateRegularMealFoodResult = {
    id: data[0],
  };
  return result;
}
