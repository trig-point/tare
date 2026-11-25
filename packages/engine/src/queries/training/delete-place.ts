import type { Database } from "better-sqlite3";

export type DeletePlaceParams = {
  user_id: number;
  id: number;
};

export type DeletePlaceResult = {
  id: number;
};

export function deletePlace(
  db: Database,
  params: DeletePlaceParams,
): DeletePlaceResult | null {
  const sql = `
	DELETE FROM training_places
	WHERE user_id = ? AND id = ?
	RETURNING id;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToDeletePlaceResult(res) : null;
}

function mapArrayToDeletePlaceResult(data: any) {
  const result: DeletePlaceResult = {
    id: data[0],
  };
  return result;
}
