import type { Database } from "better-sqlite3";

export type SelectActivitiesParams = {
  user_id: number;
  day: string;
};

export type SelectActivitiesResult = {
  id: number;
  started_at: string;
  duration_minutes: number;
  kind: string;
  calories: number | null;
  source: string;
};

export function selectActivities(
  db: Database,
  params: SelectActivitiesParams,
): SelectActivitiesResult[] {
  const sql = `
	SELECT id, started_at, duration_minutes, kind, calories, source FROM activity_sessions
	WHERE user_id = ? AND day = ? ORDER BY started_at, id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.day]);

  return rows.map((data) => mapArrayToSelectActivitiesResult(data));
}

function mapArrayToSelectActivitiesResult(data: any) {
  const result: SelectActivitiesResult = {
    id: data[0],
    started_at: data[1],
    duration_minutes: data[2],
    kind: data[3],
    calories: data[4],
    source: data[5],
  };
  return result;
}
