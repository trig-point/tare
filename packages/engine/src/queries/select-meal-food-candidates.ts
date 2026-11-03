import type { Database } from "better-sqlite3";

export type SelectMealFoodCandidatesParams = {
  user_id: number;
};

export type SelectMealFoodCandidatesResult = {
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
  service: string | null;
  meal_name: string | null;
  chef: string | null;
  meal_key: string | null;
};

export function selectMealFoodCandidates(
  db: Database,
  params: SelectMealFoodCandidatesParams,
): SelectMealFoodCandidatesResult[] {
  const sql = `
	SELECT * FROM foods
	WHERE user_id = ? AND service IS NOT NULL AND meal_name IS NOT NULL
	ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectMealFoodCandidatesResult(data));
}

function mapArrayToSelectMealFoodCandidatesResult(data: any) {
  const result: SelectMealFoodCandidatesResult = {
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
    service: data[15],
    meal_name: data[16],
    chef: data[17],
    meal_key: data[18],
  };
  return result;
}
