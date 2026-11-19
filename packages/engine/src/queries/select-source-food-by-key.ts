import type { Database } from "better-sqlite3";

export type SelectSourceFoodByKeyParams = {
  source: "usda" | "off";
  source_key: string;
};

export type SelectSourceFoodByKeyResult = {
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

export function selectSourceFoodByKey(
  db: Database,
  params: SelectSourceFoodByKeyParams,
): SelectSourceFoodByKeyResult | null {
  const sql = `
	SELECT * FROM source_foods WHERE source = ? AND source_key = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.source, params.source_key]);

  return res ? mapArrayToSelectSourceFoodByKeyResult(res) : null;
}

function mapArrayToSelectSourceFoodByKeyResult(data: any) {
  const result: SelectSourceFoodByKeyResult = {
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
