import type { Database } from "better-sqlite3";

export type FillImportDayParams = {
  user_id: number | null;
  day: string;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export type FillImportDayResult = {
  changes: number;
  lastInsertRowid: number;
};

export function fillImportDay(
  db: Database,
  params: FillImportDayParams,
): FillImportDayResult {
  const sql = `
	INSERT INTO days (user_id, day, hunger, fullness, notes, signed_off_at)
	VALUES (?, ?, ?, ?, ?, NULL)
	ON CONFLICT (user_id, day) DO UPDATE SET
	    hunger = COALESCE(days.hunger, ?),
	    fullness = COALESCE(days.fullness, ?),
	    notes = COALESCE(NULLIF(days.notes, ''), ?),
	    signed_off_at = NULL;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.day,
      params.hunger,
      params.fullness,
      params.notes,
      params.hunger,
      params.fullness,
      params.notes,
    ]) as FillImportDayResult;
}
