import type { Database } from "better-sqlite3";

export type SetDayTypeParams = {
  user_id: number | null;
  day: string;
  day_type_id: number;
};

export type SetDayTypeResult = {
  changes: number;
  lastInsertRowid: number;
};

export function setDayType(
  db: Database,
  params: SetDayTypeParams,
): SetDayTypeResult {
  const sql = `
	INSERT INTO day_type_choices (user_id, day, day_type_id) VALUES (?, ?, ?)
	ON CONFLICT (user_id, day) DO UPDATE SET day_type_id = excluded.day_type_id;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.day, params.day_type_id]) as SetDayTypeResult;
}
