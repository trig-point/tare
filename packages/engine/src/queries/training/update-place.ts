import type { Database } from "better-sqlite3";

export type UpdatePlaceData = {
  name: string;
  notes: string | null;
};

export type UpdatePlaceParams = {
  user_id: number;
  id: number;
};

export type UpdatePlaceResult = {
  id: number;
  name: string;
  notes: string | null;
};

export function updatePlace(
  db: Database,
  data: UpdatePlaceData,
  params: UpdatePlaceParams,
): UpdatePlaceResult | null {
  const sql = `
	UPDATE training_places
	SET name = ?, notes = ?
	WHERE user_id = ? AND id = ?
	RETURNING id, name, notes;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([data.name, data.notes, params.user_id, params.id]);

  return res ? mapArrayToUpdatePlaceResult(res) : null;
}

function mapArrayToUpdatePlaceResult(data: any) {
  const result: UpdatePlaceResult = {
    id: data[0],
    name: data[1],
    notes: data[2],
  };
  return result;
}
