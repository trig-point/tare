import type { Database } from "better-sqlite3";

export type RecentLoggedSessionsParams = {
  user_id: number;
};

export type RecentLoggedSessionsResult = {
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

export function recentLoggedSessions(
  db: Database,
  params: RecentLoggedSessionsParams,
): RecentLoggedSessionsResult[] {
  const sql = `
	SELECT id, timing, started_at, day, duration_minutes, kind, calories, notes, source
	FROM activity_sessions
	WHERE user_id = ? AND source IN ('manual', 'agent')
	ORDER BY day DESC, started_at DESC, id DESC
	LIMIT 5;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToRecentLoggedSessionsResult(data));
}

function mapArrayToRecentLoggedSessionsResult(data: any) {
  const result: RecentLoggedSessionsResult = {
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
