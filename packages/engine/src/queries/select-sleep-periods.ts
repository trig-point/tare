import type { Database } from "better-sqlite3";

export type SelectSleepPeriodsParams = {
  user_id: number;
  from: string;
  to: string;
};

export type SelectSleepPeriodsResult = {
  id: number;
  day: string;
  started_at: string;
  ended_at: string;
  sleep_minutes: number;
};

export function selectSleepPeriods(
  db: Database,
  params: SelectSleepPeriodsParams,
): SelectSleepPeriodsResult[] {
  const sql = `
	SELECT id, day, started_at, ended_at, sleep_minutes FROM sleep_periods
	WHERE user_id = ? AND day BETWEEN ? AND ?
	ORDER BY day, sleep_minutes DESC, started_at, id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.from, params.to]);

  return rows.map((data) => mapArrayToSelectSleepPeriodsResult(data));
}

function mapArrayToSelectSleepPeriodsResult(data: any) {
  const result: SelectSleepPeriodsResult = {
    id: data[0],
    day: data[1],
    started_at: data[2],
    ended_at: data[3],
    sleep_minutes: data[4],
  };
  return result;
}
