import type { Database } from "better-sqlite3";

export type InsertIntakeEntryParams = {
  user_id: number;
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
};

export type InsertIntakeEntryResult = {
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
};

export function insertIntakeEntry(
  db: Database,
  params: InsertIntakeEntryParams,
): InsertIntakeEntryResult | null {
  const sql = `
	INSERT INTO intake_entries (user_id, client_id, food_id, source_food_id, servings, eaten_at, day, kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance, source, portion_note, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.client_id,
      params.food_id,
      params.source_food_id,
      params.servings,
      params.eaten_at,
      params.day,
      params.kcal,
      params.protein_g,
      params.carbs_g,
      params.fat_g,
      params.fiber_g,
      params.kcal_low,
      params.kcal_high,
      params.provenance,
      params.source,
      params.portion_note,
      params.created_at,
      params.updated_at,
    ]);

  return res ? mapArrayToInsertIntakeEntryResult(res) : null;
}

function mapArrayToInsertIntakeEntryResult(data: any) {
  const result: InsertIntakeEntryResult = {
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
  };
  return result;
}
