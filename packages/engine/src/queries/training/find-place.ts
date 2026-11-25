import type { Database } from "better-sqlite3";

export type FindPlaceParams = {
  user_id: number;
  id: number;
};

export type FindPlaceResult = {
  id: number;
};

export function findPlace(
  db: Database,
  params: FindPlaceParams,
): FindPlaceResult | null {
  const sql = `
	SELECT id
	FROM training_places
	WHERE user_id = ? AND id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToFindPlaceResult(res) : null;
}

function mapArrayToFindPlaceResult(data: any) {
  const result: FindPlaceResult = {
    id: data[0],
  };
  return result;
}
