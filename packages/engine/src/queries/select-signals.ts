import type { Database } from "better-sqlite3";

export type SelectSignalsParams = {
  user_id: number;
  day: string;
};

export type SelectSignalsResult = {
  metric: string;
  value: number;
  source: string;
};

export function selectSignals(
  db: Database,
  params: SelectSignalsParams,
): SelectSignalsResult[] {
  const sql = `
	SELECT metric, value, source FROM daily_signals
	WHERE user_id = ? AND day = ? ORDER BY metric, source;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.day]);

  return rows.map((data) => mapArrayToSelectSignalsResult(data));
}

function mapArrayToSelectSignalsResult(data: any) {
  const result: SelectSignalsResult = {
    metric: data[0],
    value: data[1],
    source: data[2],
  };
  return result;
}
