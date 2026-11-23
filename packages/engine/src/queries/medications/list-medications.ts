import type { Database } from "better-sqlite3";

export type ListMedicationsResult = {
  id: number;
  name: string;
  active: number;
  late_after_minutes: number;
  active_since: string;
  generated_until: string;
};

export function listMedications(db: Database): ListMedicationsResult[] {
  const sql = `
	SELECT * FROM medications ORDER BY id
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToListMedicationsResult(data));
}

function mapArrayToListMedicationsResult(data: any) {
  const result: ListMedicationsResult = {
    id: data[0],
    name: data[1],
    active: data[2],
    late_after_minutes: data[3],
    active_since: data[4],
    generated_until: data[5],
  };
  return result;
}
