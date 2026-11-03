import type { Database } from "better-sqlite3";

export type SetDefaultDayTypeParams = {
  user_id: number | null;
  day_type_id: number;
};

export type SetDefaultDayTypeResult = {
  changes: number;
  lastInsertRowid: number;
};

export function setDefaultDayType(
  db: Database,
  params: SetDefaultDayTypeParams,
): SetDefaultDayTypeResult {
  const sql = `
	INSERT INTO default_day_types (user_id, day_type_id) VALUES (?, ?)
	ON CONFLICT (user_id) DO UPDATE SET day_type_id = excluded.day_type_id;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.day_type_id]) as SetDefaultDayTypeResult;
}
