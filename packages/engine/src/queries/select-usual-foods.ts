import type { Database } from "better-sqlite3";

export type SelectUsualFoodsParams = {
  user_id: number;
  since: string;
  until: string;
  limit: number;
};

export type SelectUsualFoodsResult = {
  food_id: number | null;
  source_food_id: number | null;
  times: number;
  servings: number | null;
  name: string | null;
  brand: string | null;
  serving_size: number | null;
  serving_unit: string | null;
  kcal: number | null;
  protein_g: number | null;
};

export function selectUsualFoods(
  db: Database,
  params: SelectUsualFoodsParams,
): SelectUsualFoodsResult[] {
  const sql = `
	WITH recent AS (
	  SELECT food_id, source_food_id, servings, eaten_at
	  FROM intake_entries
	  WHERE user_id = ? AND day >= ? AND day <= ?
	    AND (food_id IS NOT NULL OR source_food_id IS NOT NULL)
	),
	counts AS (
	  SELECT food_id, source_food_id, count(*) AS times, max(eaten_at) AS last_eaten_at
	  FROM recent
	  GROUP BY food_id, source_food_id
	),
	serving_counts AS (
	  SELECT food_id, source_food_id, servings,
	    row_number() OVER (
	      PARTITION BY food_id, source_food_id
	      ORDER BY count(*) DESC, max(eaten_at) DESC
	    ) AS position
	  FROM recent
	  GROUP BY food_id, source_food_id, servings
	)
	SELECT counts.food_id, counts.source_food_id, counts.times, serving_counts.servings,
	  coalesce(foods.name, source_foods.name) AS name,
	  source_foods.brand,
	  coalesce(foods.serving_size, source_foods.serving_size) AS serving_size,
	  coalesce(foods.serving_unit, source_foods.serving_unit) AS serving_unit,
	  coalesce(foods.kcal, source_foods.kcal) AS kcal,
	  coalesce(foods.protein_g, source_foods.protein_g) AS protein_g
	FROM counts
	JOIN serving_counts ON serving_counts.food_id IS counts.food_id
	  AND serving_counts.source_food_id IS counts.source_food_id
	  AND serving_counts.position = 1
	LEFT JOIN foods ON foods.user_id = ? AND foods.id = counts.food_id
	LEFT JOIN source_foods ON source_foods.id = counts.source_food_id
	WHERE NOT EXISTS (
	  SELECT 1 FROM regular_meals
	  WHERE regular_meals.user_id = ? AND regular_meals.food_id = counts.food_id
	    AND regular_meals.archived_at IS NOT NULL
	)
	ORDER BY counts.times DESC, counts.last_eaten_at DESC, counts.food_id, counts.source_food_id
	LIMIT ?;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      params.user_id,
      params.since,
      params.until,
      params.user_id,
      params.user_id,
      params.limit,
    ]);

  return rows.map((data) => mapArrayToSelectUsualFoodsResult(data));
}

function mapArrayToSelectUsualFoodsResult(data: any) {
  const result: SelectUsualFoodsResult = {
    food_id: data[0],
    source_food_id: data[1],
    times: data[2],
    servings: data[3],
    name: data[4],
    brand: data[5],
    serving_size: data[6],
    serving_unit: data[7],
    kcal: data[8],
    protein_g: data[9],
  };
  return result;
}
