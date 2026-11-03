import type { Database } from "better-sqlite3";

export type InsertActivityParams = {
  user_id: number;
  client_id: string | null;
  started_at: string;
  day: string;
  duration_minutes: number;
  kind: string;
  calories: number | null;
  source: string;
  created_at: string;
};

export type InsertActivityResult = {
  id: number;
  user_id: number;
  client_id: string | null;
  started_at: string;
  day: string;
  duration_minutes: number;
  kind: string;
  calories: number | null;
  source: string;
  source_record_id: string | null;
  created_at: string;
};

export function insertActivity(
  db: Database,
  params: InsertActivityParams,
): InsertActivityResult | null {
  const sql = `
	INSERT INTO activity_sessions (user_id, client_id, started_at, day, duration_minutes, kind, calories, source, source_record_id, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
	ON CONFLICT (user_id, client_id) DO NOTHING RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.client_id,
      params.started_at,
      params.day,
      params.duration_minutes,
      params.kind,
      params.calories,
      params.source,
      params.created_at,
    ]);

  return res ? mapArrayToInsertActivityResult(res) : null;
}

function mapArrayToInsertActivityResult(data: any) {
  const result: InsertActivityResult = {
    id: data[0],
    user_id: data[1],
    client_id: data[2],
    started_at: data[3],
    day: data[4],
    duration_minutes: data[5],
    kind: data[6],
    calories: data[7],
    source: data[8],
    source_record_id: data[9],
    created_at: data[10],
  };
  return result;
}
