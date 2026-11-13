import type { Database } from "better-sqlite3";

export type SearchOwnFoodsParams = {
  user_id: number;
  pattern: string;
};

export type SearchOwnFoodsResult = {
  id: number;
  name: string;
  serving_size: number | null;
  serving_unit: string | null;
};

export function searchOwnFoods(
  db: Database,
  params: SearchOwnFoodsParams,
): SearchOwnFoodsResult[] {
  const sql = `
	SELECT id, name, serving_size, serving_unit FROM foods
	WHERE user_id = ? AND name LIKE '%' || ? || '%' ESCAPE '!'
	AND NOT EXISTS (
	  SELECT 1 FROM regular_meals
	  WHERE regular_meals.user_id = foods.user_id AND regular_meals.food_id = foods.id
	    AND regular_meals.archived_at IS NOT NULL
	)
	ORDER BY name, id
	LIMIT 20;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.pattern]);

  return rows.map((data) => mapArrayToSearchOwnFoodsResult(data));
}

function mapArrayToSearchOwnFoodsResult(data: any) {
  const result: SearchOwnFoodsResult = {
    id: data[0],
    name: data[1],
    serving_size: data[2],
    serving_unit: data[3],
  };
  return result;
}
