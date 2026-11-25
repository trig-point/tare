import type { Database } from "better-sqlite3";

export type InsertPlaceParams = {
  user_id: number;
  name: string;
  notes: string | null;
};

export type InsertPlaceResult = {
  id: number;
  name: string;
  notes: string | null;
};

export function insertPlace(
  db: Database,
  params: InsertPlaceParams,
): InsertPlaceResult | null {
  const sql = `
	INSERT INTO training_places (user_id, name, notes)
	VALUES (?, ?, ?)
	RETURNING id, name, notes;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.name, params.notes]);

  return res ? mapArrayToInsertPlaceResult(res) : null;
}

function mapArrayToInsertPlaceResult(data: any) {
  const result: InsertPlaceResult = {
    id: data[0],
    name: data[1],
    notes: data[2],
  };
  return result;
}
