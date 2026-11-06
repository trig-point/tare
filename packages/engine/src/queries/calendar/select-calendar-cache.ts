import type { Database } from "better-sqlite3";

export type SelectCalendarCacheParams = {
  user_id: number;
  day: string;
  timezone: string;
  day_start_hour: number;
  revision: number;
};

export type SelectCalendarCacheResult = {
  status: string;
  day_type_id: number | null;
  fetched_at: string;
};

export function selectCalendarCache(
  db: Database,
  params: SelectCalendarCacheParams,
): SelectCalendarCacheResult | null {
  const sql = `
	SELECT status, day_type_id, fetched_at FROM calendar_cache
	WHERE user_id = ? AND day = ? AND timezone = ?
	AND day_start_hour = ? AND revision = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.timezone,
      params.day_start_hour,
      params.revision,
    ]);

  return res ? mapArrayToSelectCalendarCacheResult(res) : null;
}

function mapArrayToSelectCalendarCacheResult(data: any) {
  const result: SelectCalendarCacheResult = {
    status: data[0],
    day_type_id: data[1],
    fetched_at: data[2],
  };
  return result;
}
