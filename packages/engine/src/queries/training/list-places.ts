import type { Database } from "better-sqlite3";

export type ListPlacesParams = {
  user_id: number;
};

export type ListPlacesResult = {
  id: number;
  name: string;
  notes: string | null;
};

export function listPlaces(
  db: Database,
  params: ListPlacesParams,
): ListPlacesResult[] {
  const sql = `
	SELECT id, name, notes
	FROM training_places
	WHERE user_id = ?
	ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToListPlacesResult(data));
}

function mapArrayToListPlacesResult(data: any) {
  const result: ListPlacesResult = {
    id: data[0],
    name: data[1],
    notes: data[2],
  };
  return result;
}
