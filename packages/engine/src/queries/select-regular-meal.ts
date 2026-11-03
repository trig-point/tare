import type { Database } from "better-sqlite3";

export type SelectRegularMealParams = {
  user_id: number;
  id: number;
};

export type SelectRegularMealResult = {
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
  restaurant: string | null;
  baseline: string;
  created_at: string;
};

export function selectRegularMeal(
  db: Database,
  params: SelectRegularMealParams,
): SelectRegularMealResult | null {
  const sql = `
	SELECT foods.user_id, foods.id, foods.name, foods.serving_size, foods.serving_unit,
	  foods.kcal, foods.protein_g, foods.carbs_g, foods.fat_g, foods.fiber_g,
	  foods.kcal_low, foods.kcal_high, foods.provenance, foods.source, foods.source_food_id,
	  regular_meals.restaurant, regular_meals.baseline, regular_meals.created_at
	FROM regular_meals
	JOIN foods ON foods.user_id = regular_meals.user_id AND foods.id = regular_meals.food_id
	WHERE regular_meals.user_id = ? AND regular_meals.food_id = ?
	  AND regular_meals.archived_at IS NULL LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectRegularMealResult(res) : null;
}

function mapArrayToSelectRegularMealResult(data: any) {
  const result: SelectRegularMealResult = {
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
    restaurant: data[15],
    baseline: data[16],
    created_at: data[17],
  };
  return result;
}
