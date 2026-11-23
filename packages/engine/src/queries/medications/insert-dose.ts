import type { Database } from "better-sqlite3";

export type InsertDoseParams = {
  public_key: string;
  medication_id: number;
  revision_id: number;
  slot_date: string;
  slot_time: string;
  slot_at: string;
  scheduled_at: string;
};

export type InsertDoseResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertDose(
  db: Database,
  params: InsertDoseParams,
): InsertDoseResult {
  const sql = `
	INSERT INTO medication_doses
	  (public_key, medication_id, revision_id, slot_date, slot_time, slot_at, scheduled_at)
	VALUES (?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (medication_id, slot_date, slot_time) DO NOTHING
	
	`;
  return db
    .prepare(sql)
    .run([
      params.public_key,
      params.medication_id,
      params.revision_id,
      params.slot_date,
      params.slot_time,
      params.slot_at,
      params.scheduled_at,
    ]) as InsertDoseResult;
}
