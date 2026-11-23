import type { Database } from "better-sqlite3";

export type InsertMedicationParams = {
  name: string;
  active: number;
  late_after_minutes: number;
  generated_until: string;
};

export type InsertMedicationResult = {
  id: number;
  name: string;
  active: number;
  late_after_minutes: number;
  generated_until: string;
};

export function insertMedication(
  db: Database,
  params: InsertMedicationParams,
): InsertMedicationResult | null {
  const sql = `
	INSERT INTO medications (name, active, late_after_minutes, generated_until)
	VALUES (?, ?, ?, ?)
	RETURNING *
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.name,
      params.active,
      params.late_after_minutes,
      params.generated_until,
    ]);

  return res ? mapArrayToInsertMedicationResult(res) : null;
}

function mapArrayToInsertMedicationResult(data: any) {
  const result: InsertMedicationResult = {
    id: data[0],
    name: data[1],
    active: data[2],
    late_after_minutes: data[3],
    generated_until: data[4],
  };
  return result;
}
