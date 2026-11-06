import type { Database } from "better-sqlite3";

export type DeleteCalendarCacheParams = {
  user_id: number;
};

export type DeleteCalendarCacheResult = {
  changes: number;
};

export function deleteCalendarCache(
  db: Database,
  params: DeleteCalendarCacheParams,
): DeleteCalendarCacheResult {
  const sql = `
	DELETE FROM calendar_cache WHERE user_id = ?;
	
	`;
  return db.prepare(sql).run([params.user_id]) as DeleteCalendarCacheResult;
}
