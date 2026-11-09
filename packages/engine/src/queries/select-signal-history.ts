import type { Database } from "better-sqlite3";

export type SelectSignalHistoryParams = {
  user_id: number;
  from: any;
  to: string;
};

export type SelectSignalHistoryResult = {
  day: string;
  metric: string;
  value: number;
  source: string;
};

export function selectSignalHistory(
  db: Database,
  params: SelectSignalHistoryParams,
): SelectSignalHistoryResult[] {
  const sql = `
	SELECT day, metric, value, source FROM daily_signals
	WHERE user_id = ? AND day BETWEEN ? AND ?
	  AND metric IN ('active_calories', 'hrv', 'resting_heart_rate', 'sleep')
	ORDER BY metric, source, day;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.from, params.to]);

  return rows.map((data) => mapArrayToSelectSignalHistoryResult(data));
}

function mapArrayToSelectSignalHistoryResult(data: any) {
  const result: SelectSignalHistoryResult = {
    day: data[0],
    metric: data[1],
    value: data[2],
    source: data[3],
  };
  return result;
}
