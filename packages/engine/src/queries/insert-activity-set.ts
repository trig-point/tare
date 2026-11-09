import type { Database } from "better-sqlite3";

export type InsertActivitySetParams = {
  user_id: number | null;
  session_id: number | null;
  set_index: number | null;
  exercise: string;
  set_type: string;
  reps: number | null;
  load_kg: number | null;
  load_unit: string | null;
  duration_seconds: number | null;
  rir_low: number | null;
  rir_high: number | null;
  notes: string | null;
};

export type InsertActivitySetResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertActivitySet(
  db: Database,
  params: InsertActivitySetParams,
): InsertActivitySetResult {
  const sql = `
	INSERT INTO activity_sets (user_id, session_id, set_index, exercise, set_type, reps, load_kg, load_unit, duration_seconds, rir_low, rir_high, notes)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.session_id,
      params.set_index,
      params.exercise,
      params.set_type,
      params.reps,
      params.load_kg,
      params.load_unit,
      params.duration_seconds,
      params.rir_low,
      params.rir_high,
      params.notes,
    ]) as InsertActivitySetResult;
}
