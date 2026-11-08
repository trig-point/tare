import type { Database } from "better-sqlite3";

export type UpsertSourceActivityParams = {
  user_id: number;
  started_at: string;
  day: string;
  duration_minutes: number;
  kind: string;
  calories: number | null;
  source: string;
  source_record_id: string | null;
  created_at: string;
};

export type UpsertSourceActivityResult = {
  id: number;
};

export function upsertSourceActivity(
  db: Database,
  params: UpsertSourceActivityParams,
): UpsertSourceActivityResult | null {
  const sql = `
	INSERT INTO activity_sessions (user_id, client_id, started_at, day, duration_minutes, kind, calories, source, source_record_id, created_at)
	VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, source, source_record_id) DO UPDATE SET
	  started_at = excluded.started_at, day = excluded.day, duration_minutes = excluded.duration_minutes,
	  kind = excluded.kind, calories = excluded.calories
	RETURNING id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.started_at,
      params.day,
      params.duration_minutes,
      params.kind,
      params.calories,
      params.source,
      params.source_record_id,
      params.created_at,
    ]);

  return res ? mapArrayToUpsertSourceActivityResult(res) : null;
}

function mapArrayToUpsertSourceActivityResult(data: any) {
  const result: UpsertSourceActivityResult = {
    id: data[0],
  };
  return result;
}
