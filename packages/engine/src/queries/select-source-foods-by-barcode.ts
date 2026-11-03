import type { Database } from "better-sqlite3";

export type SelectSourceFoodsByBarcodeParams = {
  barcode: string;
  upc: string;
};

export type SelectSourceFoodsByBarcodeResult = {
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
  barcode: string;
};

export function selectSourceFoodsByBarcode(
  db: Database,
  params: SelectSourceFoodsByBarcodeParams,
): SelectSourceFoodsByBarcodeResult[] {
  const sql = `
	SELECT * FROM source_foods WHERE barcode = ? OR barcode = ? ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.barcode, params.upc]);

  return rows.map((data) => mapArrayToSelectSourceFoodsByBarcodeResult(data));
}

function mapArrayToSelectSourceFoodsByBarcodeResult(data: any) {
  const result: SelectSourceFoodsByBarcodeResult = {
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
