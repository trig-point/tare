import type { Database } from "better-sqlite3";

export type InsertHaEntityParams = {
  user_id: number | null;
  topic: string;
};

export type InsertHaEntityResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertHaEntity(
  db: Database,
  params: InsertHaEntityParams,
): InsertHaEntityResult {
  const sql = `
	INSERT INTO ha_entities (user_id, topic) VALUES (?, ?) ON CONFLICT DO NOTHING;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.topic]) as InsertHaEntityResult;
}
