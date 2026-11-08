import type { Database } from "better-sqlite3";

export type UpsertSleepPeriodParams = {
  user_id: number;
  source: string;
  source_record_id: string;
  day: string;
  started_at: string;
  ended_at: string;
  sleep_minutes: number;
  kind: string;
  updated_at: string;
};

export type UpsertSleepPeriodResult = {
  id: number;
};

export function upsertSleepPeriod(
  db: Database,
  params: UpsertSleepPeriodParams,
): UpsertSleepPeriodResult | null {
  const sql = `
	INSERT INTO sleep_periods (user_id, source, source_record_id, day, started_at, ended_at, sleep_minutes, kind, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, source, source_record_id) DO UPDATE SET
	  day = excluded.day, started_at = excluded.started_at, ended_at = excluded.ended_at,
	  sleep_minutes = excluded.sleep_minutes, kind = excluded.kind, updated_at = excluded.updated_at
	RETURNING id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.source,
      params.source_record_id,
      params.day,
      params.started_at,
      params.ended_at,
      params.sleep_minutes,
      params.kind,
      params.updated_at,
    ]);

  return res ? mapArrayToUpsertSleepPeriodResult(res) : null;
}

function mapArrayToUpsertSleepPeriodResult(data: any) {
  const result: UpsertSleepPeriodResult = {
    id: data[0],
  };
  return result;
}
