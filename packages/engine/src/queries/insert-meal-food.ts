import type { Database } from "better-sqlite3";

export type InsertMealFoodParams = {
  user_id: number;
  name: string;
  serving_size: number | null;
  serving_unit: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  provenance: string;
  source: string | null;
  service: string | null;
  meal_name: string | null;
  chef: string | null;
  meal_key: string | null;
};

export type InsertMealFoodResult = {
  id: number;
};

export function insertMealFood(
  db: Database,
  params: InsertMealFoodParams,
): InsertMealFoodResult | null {
  const sql = `
	INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, provenance, source, service, meal_name, chef, meal_key)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	RETURNING id;
	
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
      params.provenance,
      params.source,
      params.service,
      params.meal_name,
      params.chef,
      params.meal_key,
    ]);

  return res ? mapArrayToInsertMealFoodResult(res) : null;
}

function mapArrayToInsertMealFoodResult(data: any) {
  const result: InsertMealFoodResult = {
    id: data[0],
  };
  return result;
}
