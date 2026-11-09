import type { Database } from "better-sqlite3";

export type SelectActivitiesParams = {
  user_id: number;
  from: string;
  to: string;
};

export type SelectActivitiesResult = {
  id: number;
  timing: string;
  started_at: string | null;
  day: string;
  duration_minutes: number | null;
  kind: string;
  calories: number | null;
  notes: string | null;
  source: string;
};

export function selectActivities(
  db: Database,
  params: SelectActivitiesParams,
): SelectActivitiesResult[] {
  const sql = `
	SELECT id, timing, started_at, day, duration_minutes, kind, calories, notes, source FROM activity_sessions
	WHERE user_id = ? AND day BETWEEN ? AND ?
	ORDER BY day, started_at IS NULL, started_at, id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.from, params.to]);

  return rows.map((data) => mapArrayToSelectActivitiesResult(data));
}

function mapArrayToSelectActivitiesResult(data: any) {
  const result: SelectActivitiesResult = {
    id: data[0],
    timing: data[1],
    started_at: data[2],
    day: data[3],
    duration_minutes: data[4],
    kind: data[5],
    calories: data[6],
    notes: data[7],
    source: data[8],
  };
  return result;
}
