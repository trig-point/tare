import type { Database } from "better-sqlite3";

export type UpsertSignalParams = {
  user_id: number | null;
  day: string;
  metric: string;
  value: number;
  source: string;
  updated_at: string;
};

export type UpsertSignalResult = {
  user_id: number;
  day: string;
  metric: string;
  value: number;
  source: string;
  updated_at: string;
};

export function upsertSignal(
  db: Database,
  params: UpsertSignalParams,
): UpsertSignalResult | null {
  const sql = `
	INSERT INTO daily_signals (user_id, day, metric, value, source, updated_at)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, day, metric, source) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.metric,
      params.value,
      params.source,
      params.updated_at,
    ]);

  return res ? mapArrayToUpsertSignalResult(res) : null;
}

function mapArrayToUpsertSignalResult(data: any) {
  const result: UpsertSignalResult = {
    user_id: data[0],
    day: data[1],
    metric: data[2],
    value: data[3],
    source: data[4],
    updated_at: data[5],
  };
  return result;
}
