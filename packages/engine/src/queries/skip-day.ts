import type { Database } from "better-sqlite3";

export type SkipDayData = {
  skipped_at: string | null;
};

export type SkipDayParams = {
  user_id: number;
  day: string;
};

export type SkipDayResult = {
  day: string;
};

export function skipDay(
  db: Database,
  data: SkipDayData,
  params: SkipDayParams,
): SkipDayResult[] {
  const sql = `
	UPDATE days
	SET skipped_at = ?
	WHERE user_id = ? AND day = ? AND signed_off_at IS NULL
	RETURNING day;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.skipped_at, params.user_id, params.day]);

  return rows.map((data) => mapArrayToSkipDayResult(data));
}

function mapArrayToSkipDayResult(data: any) {
  const result: SkipDayResult = {
    day: data[0],
  };
  return result;
}
