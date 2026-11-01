import type { Database } from "better-sqlite3";

export type InsertSourceFoodParams = {
  source: string;
  source_key: string;
  name: string;
  brand: string | null;
  serving_size: number | null;
  serving_unit: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  provenance: string;
  fetched_at: string;
};

export type InsertSourceFoodResult = {
  id: number;
  source: string;
  source_key: string;
  name: string;
  brand: string | null;
  serving_size: number | null;
  serving_unit: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  provenance: string;
  fetched_at: string;
};

export function insertSourceFood(
  db: Database,
  params: InsertSourceFoodParams,
): InsertSourceFoodResult | null {
  const sql = `
	INSERT INTO source_foods (source, source_key, name, brand, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, provenance, fetched_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.source,
      params.source_key,
      params.name,
      params.brand,
      params.serving_size,
      params.serving_unit,
      params.kcal,
      params.protein_g,
      params.carbs_g,
      params.fat_g,
      params.fiber_g,
      params.provenance,
      params.fetched_at,
    ]);

  return res ? mapArrayToInsertSourceFoodResult(res) : null;
}

function mapArrayToInsertSourceFoodResult(data: any) {
  const result: InsertSourceFoodResult = {
    id: data[0],
    source: data[1],
    source_key: data[2],
    name: data[3],
    brand: data[4],
    serving_size: data[5],
    serving_unit: data[6],
    kcal: data[7],
    protein_g: data[8],
    carbs_g: data[9],
    fat_g: data[10],
    fiber_g: data[11],
    provenance: data[12],
    fetched_at: data[13],
  };
  return result;
}
