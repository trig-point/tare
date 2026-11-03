import type { Database } from "better-sqlite3";

export type SelectLedgerEntriesParams = {
  user_id: number;
  day: string;
};

export type SelectLedgerEntriesResult = {
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
};

export function selectLedgerEntries(
  db: Database,
  params: SelectLedgerEntriesParams,
): SelectLedgerEntriesResult[] {
  const sql = `
	SELECT * FROM intake_entries
	WHERE user_id = ? AND day = ?
	ORDER BY eaten_at, id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.day]);

  return rows.map((data) => mapArrayToSelectLedgerEntriesResult(data));
}

function mapArrayToSelectLedgerEntriesResult(data: any) {
  const result: SelectLedgerEntriesResult = {
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
  };
  return result;
}
