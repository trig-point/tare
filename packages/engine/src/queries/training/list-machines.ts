import type { Database } from "better-sqlite3";

export type ListMachinesParams = {
  user_id: number;
};

export type ListMachinesResult = {
  id: number;
  place_id: number;
  name: string;
  notes: string | null;
  photo_urls: string;
  movements: string;
};

export function listMachines(
  db: Database,
  params: ListMachinesParams,
): ListMachinesResult[] {
  const sql = `
	SELECT id, place_id, name, notes, photo_urls, movements
	FROM training_machines
	WHERE user_id = ?
	ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToListMachinesResult(data));
}

function mapArrayToListMachinesResult(data: any) {
  const result: ListMachinesResult = {
    id: data[0],
    place_id: data[1],
    name: data[2],
    notes: data[3],
    photo_urls: data[4],
    movements: data[5],
  };
  return result;
}
