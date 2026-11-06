import type { Database } from "better-sqlite3";

export type CommitCalendarCacheParams = {
  user_id: number | null;
  day: string;
  timezone: string;
  day_start_hour: number | null;
  revision: number | null;
  status: string;
  day_type_id: number | null;
  fetched_at: string;
};

export type CommitCalendarCacheResult = {
  changes: number;
  lastInsertRowid: number;
};

export function commitCalendarCache(
  db: Database,
  params: CommitCalendarCacheParams,
): CommitCalendarCacheResult {
  const sql = `
	INSERT INTO calendar_cache (user_id, day, timezone, day_start_hour, revision, status, day_type_id, fetched_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, day, timezone, day_start_hour, revision)
	DO UPDATE SET status = excluded.status, day_type_id = excluded.day_type_id, fetched_at = excluded.fetched_at;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.day,
      params.timezone,
      params.day_start_hour,
      params.revision,
      params.status,
      params.day_type_id,
      params.fetched_at,
    ]) as CommitCalendarCacheResult;
}
