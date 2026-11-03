import type { Database } from "better-sqlite3";

export type UpsertSourceFoodParams = {
  source: "usda" | "off";
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
  provenance: "verified" | "label";
  fetched_at: string;
  barcode: string | null;
};

export type UpsertSourceFoodResult = {
  id: number;
  source: "usda" | "off";
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
  provenance: "verified" | "label";
  fetched_at: string;
  barcode: string | null;
};

export function upsertSourceFood(
  db: Database,
  params: UpsertSourceFoodParams,
): UpsertSourceFoodResult | null {
  const sql = `
	INSERT INTO source_foods (source, source_key, name, brand, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, provenance, fetched_at, barcode)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (source, source_key) DO UPDATE SET
	  name = excluded.name, brand = excluded.brand,
	  serving_size = excluded.serving_size, serving_unit = excluded.serving_unit,
	  kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
	  fat_g = excluded.fat_g, fiber_g = excluded.fiber_g,
	  provenance = excluded.provenance, fetched_at = excluded.fetched_at,
	  barcode = COALESCE(?, source_foods.barcode)
	RETURNING *;
	
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
      params.barcode,
      params.barcode,
    ]);

  return res ? mapArrayToUpsertSourceFoodResult(res) : null;
}

function mapArrayToUpsertSourceFoodResult(data: any) {
  const result: UpsertSourceFoodResult = {
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
    barcode: data[14],
  };
  return result;
}
