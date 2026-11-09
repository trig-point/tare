import type { Database } from "better-sqlite3";

export type InsertScaleReadingParams = {
  client_id: string;
  user_id: number;
  created_at: string;
};

export type InsertScaleReadingResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertScaleReading(
  db: Database,
  params: InsertScaleReadingParams,
): InsertScaleReadingResult {
  const sql = `
	INSERT INTO scale_readings (client_id, user_id, created_at)
	VALUES (?, ?, ?)
	ON CONFLICT (client_id) DO NOTHING;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.client_id,
      params.user_id,
      params.created_at,
    ]) as InsertScaleReadingResult;
}
