import type { Database } from "better-sqlite3";

export type PruneCalendarCacheParams = {
  user_id: number;
  day: any;
};

export type PruneCalendarCacheResult = {
  changes: number;
};

export function pruneCalendarCache(
  db: Database,
  params: PruneCalendarCacheParams,
): PruneCalendarCacheResult {
  const sql = `
	DELETE FROM calendar_cache WHERE user_id = ? AND day < date(?, '-2 days');
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.day]) as PruneCalendarCacheResult;
}
