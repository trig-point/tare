import type { Database } from "better-sqlite3";

export type RecentLoggedSessionsParams = {
  user_id: number;
};

export type RecentLoggedSessionsResult = {
  id: number;
  day: string;
};

export function recentLoggedSessions(
  db: Database,
  params: RecentLoggedSessionsParams,
): RecentLoggedSessionsResult[] {
  const sql = `
	SELECT id, day
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
    day: data[1],
  };
  return result;
}
