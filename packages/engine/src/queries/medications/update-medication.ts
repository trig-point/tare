import type { Database } from "better-sqlite3";

export type UpdateMedicationData = {
  name: string;
  active: number;
  late_after_minutes: number;
  water_ml: number | null;
  generated_until: string;
};

export type UpdateMedicationParams = {
  id: number;
};

export type UpdateMedicationResult = {
  changes: number;
};

export function updateMedication(
  db: Database,
  data: UpdateMedicationData,
  params: UpdateMedicationParams,
): UpdateMedicationResult {
  const sql = `
	UPDATE medications
	SET name = ?, active = ?, late_after_minutes = ?,
	    water_ml = ?, generated_until = ?
	WHERE id = ?
	
	`;
  return db
    .prepare(sql)
    .run([
      data.name,
      data.active,
      data.late_after_minutes,
      data.water_ml,
      data.generated_until,
      params.id,
    ]) as UpdateMedicationResult;
}
