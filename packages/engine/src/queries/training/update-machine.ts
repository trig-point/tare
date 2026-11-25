import type { Database } from "better-sqlite3";

export type UpdateMachineData = {
  place_id: number;
  name: string;
  notes: string | null;
  photo_urls: string;
  movements: string;
};

export type UpdateMachineParams = {
  user_id: number;
  id: number;
};

export type UpdateMachineResult = {
  id: number;
  place_id: number;
  name: string;
  notes: string | null;
  photo_urls: string;
  movements: string;
};

export function updateMachine(
  db: Database,
  data: UpdateMachineData,
  params: UpdateMachineParams,
): UpdateMachineResult | null {
  const sql = `
	UPDATE training_machines
	SET place_id = ?, name = ?, notes = ?, photo_urls = ?, movements = ?
	WHERE user_id = ? AND id = ?
	RETURNING id, place_id, name, notes, photo_urls, movements;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      data.place_id,
      data.name,
      data.notes,
      data.photo_urls,
      data.movements,
      params.user_id,
      params.id,
    ]);

  return res ? mapArrayToUpdateMachineResult(res) : null;
}

function mapArrayToUpdateMachineResult(data: any) {
  const result: UpdateMachineResult = {
    id: data[0],
    place_id: data[1],
    name: data[2],
    notes: data[3],
    photo_urls: data[4],
    movements: data[5],
  };
  return result;
}
