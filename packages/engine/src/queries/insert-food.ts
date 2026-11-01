import type { Database } from "better-sqlite3";

export type InsertFoodParams = {
  user_id: number;
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

export type InsertFoodResult = {
  user_id: number;
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

export function insertFood(
  db: Database,
  params: InsertFoodParams,
): InsertFoodResult | null {
  const sql = `
	INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance, source, source_food_id)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.name,
      params.serving_size,
      params.serving_unit,
      params.kcal,
      params.protein_g,
      params.carbs_g,
      params.fat_g,
      params.fiber_g,
      params.kcal_low,
      params.kcal_high,
      params.provenance,
      params.source,
      params.source_food_id,
    ]);

  return res ? mapArrayToInsertFoodResult(res) : null;
}

function mapArrayToInsertFoodResult(data: any) {
  const result: InsertFoodResult = {
    user_id: data[0],
    id: data[1],
    name: data[2],
    serving_size: data[3],
    serving_unit: data[4],
    kcal: data[5],
    protein_g: data[6],
    carbs_g: data[7],
    fat_g: data[8],
    fiber_g: data[9],
    kcal_low: data[10],
    kcal_high: data[11],
    provenance: data[12],
    source: data[13],
    source_food_id: data[14],
  };
  return result;
}
