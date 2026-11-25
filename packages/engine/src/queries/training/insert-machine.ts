import type { Database } from "better-sqlite3";

export type InsertMachineParams = {
  user_id: number;
  place_id: number;
  name: string;
  notes: string | null;
  photo_urls: string;
  movements: string;
};

export type InsertMachineResult = {
  id: number;
  place_id: number;
  name: string;
  notes: string | null;
  photo_urls: string;
  movements: string;
};

export function insertMachine(
  db: Database,
  params: InsertMachineParams,
): InsertMachineResult | null {
  const sql = `
	INSERT INTO training_machines (user_id, place_id, name, notes, photo_urls, movements)
	VALUES (?, ?, ?, ?, ?, ?)
	RETURNING id, place_id, name, notes, photo_urls, movements;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.place_id,
      params.name,
      params.notes,
      params.photo_urls,
      params.movements,
    ]);

  return res ? mapArrayToInsertMachineResult(res) : null;
}

function mapArrayToInsertMachineResult(data: any) {
  const result: InsertMachineResult = {
    id: data[0],
    place_id: data[1],
    name: data[2],
    notes: data[3],
    photo_urls: data[4],
    movements: data[5],
  };
  return result;
}
