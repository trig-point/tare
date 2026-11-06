import type { Database } from "better-sqlite3";

export type SelectSelectedDayTypeParams = {
  user_id: number;
  day: string;
  timezone: string;
  day_start_hour: number;
  fresh_after: string;
  now: string;
};

export type SelectSelectedDayTypeResult = {
  id: number;
  user_id: number;
  name: string;
  template_id: number;
};

export function selectSelectedDayType(
  db: Database,
  params: SelectSelectedDayTypeParams,
): SelectSelectedDayTypeResult | null {
  const sql = `
	SELECT id, user_id, name, template_id FROM day_types
	WHERE user_id = ? AND id = COALESCE(
	  (SELECT day_type_id FROM day_type_choices WHERE user_id = ? AND day = ?),
	  (SELECT cache.day_type_id FROM calendar_cache cache
	   JOIN calendar_settings settings ON settings.user_id = cache.user_id AND settings.revision = cache.revision
	   WHERE cache.user_id = ? AND cache.day = ? AND cache.timezone = ?
	   AND cache.day_start_hour = ? AND settings.enabled = 1 AND cache.status = 'match'
	   AND cache.fetched_at > ? AND cache.fetched_at <= ?),
	  (SELECT day_type_id FROM default_day_types WHERE user_id = ?)
	);
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.user_id,
      params.day,
      params.user_id,
      params.day,
      params.timezone,
      params.day_start_hour,
      params.fresh_after,
      params.now,
      params.user_id,
    ]);

  return res ? mapArrayToSelectSelectedDayTypeResult(res) : null;
}

function mapArrayToSelectSelectedDayTypeResult(data: any) {
  const result: SelectSelectedDayTypeResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    template_id: data[3],
  };
  return result;
}
