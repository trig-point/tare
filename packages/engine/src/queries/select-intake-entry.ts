import type { Database } from "better-sqlite3";

export type SelectIntakeEntryParams = {
  user_id: number;
  id: number;
};

export type SelectIntakeEntryResult = {
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
  slot_template_id: number | null;
  slot_position: number | null;
  amount_estimated: number;
  servings_low: number | null;
  servings_high: number | null;
  eating_out: number;
  kcal_basis: string;
  packaged_food: number;
};

export function selectIntakeEntry(
  db: Database,
  params: SelectIntakeEntryParams,
): SelectIntakeEntryResult | null {
  const sql = `
	SELECT user_id, id, client_id, food_id, source_food_id, servings, eaten_at, day,
	  kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance,
	  source, portion_note, created_at, updated_at, name, slot_template_id,
	  slot_position, amount_estimated, servings_low, servings_high, eating_out, kcal_basis, packaged_food FROM intake_entries WHERE user_id = ? AND id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectIntakeEntryResult(res) : null;
}

function mapArrayToSelectIntakeEntryResult(data: any) {
  const result: SelectIntakeEntryResult = {
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
    slot_template_id: data[21],
    slot_position: data[22],
    amount_estimated: data[23],
    servings_low: data[24],
    servings_high: data[25],
    eating_out: data[26],
    kcal_basis: data[27],
    packaged_food: data[28],
  };
  return result;
}
