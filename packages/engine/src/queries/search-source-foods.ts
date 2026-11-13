import type { Database } from "better-sqlite3";

export type SearchSourceFoodsParams = {
  pattern: string;
};

export type SearchSourceFoodsResult = {
  id: number;
  name: string;
  brand: string | null;
  serving_size: number | null;
  serving_unit: string | null;
};

export function searchSourceFoods(
  db: Database,
  params: SearchSourceFoodsParams,
): SearchSourceFoodsResult[] {
  const sql = `
	SELECT id, name, brand, serving_size, serving_unit FROM source_foods
	WHERE name LIKE '%' || ? || '%' ESCAPE '!'
	ORDER BY name, id
	LIMIT 20;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.pattern]);

  return rows.map((data) => mapArrayToSearchSourceFoodsResult(data));
}

function mapArrayToSearchSourceFoodsResult(data: any) {
  const result: SearchSourceFoodsResult = {
    id: data[0],
    name: data[1],
    brand: data[2],
    serving_size: data[3],
    serving_unit: data[4],
  };
  return result;
}
