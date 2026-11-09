import type { Database } from "better-sqlite3";

export type InsertActivityParams = {
  user_id: number;
  client_id: string | null;
  timing: string;
  started_at: string | null;
  day: string;
  duration_minutes: number | null;
  kind: string;
  calories: number | null;
  notes: string | null;
  source: string;
  created_at: string;
};

export type InsertActivityResult = {
  id: number;
  user_id: number;
  client_id: string | null;
  timing: string;
  started_at: string | null;
  day: string;
  duration_minutes: number | null;
  kind: string;
  calories: number | null;
  notes: string | null;
  source: string;
  source_record_id: string | null;
  created_at: string;
};

export function insertActivity(
  db: Database,
  params: InsertActivityParams,
): InsertActivityResult | null {
  const sql = `
	INSERT INTO activity_sessions (user_id, client_id, timing, started_at, day, duration_minutes, kind, calories, notes, source, source_record_id, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
	ON CONFLICT (user_id, client_id) DO NOTHING RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.client_id,
      params.timing,
      params.started_at,
      params.day,
      params.duration_minutes,
      params.kind,
      params.calories,
      params.notes,
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
    timing: data[3],
    started_at: data[4],
    day: data[5],
    duration_minutes: data[6],
    kind: data[7],
    calories: data[8],
    notes: data[9],
    source: data[10],
    source_record_id: data[11],
    created_at: data[12],
  };
  return result;
}
