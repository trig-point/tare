import type { Database } from "better-sqlite3";

export type SelectAdaptiveDaysParams = {
  user_id: number;
  start: string;
  end: string;
};

export type SelectAdaptiveDaysResult = {
  day: string;
};

export function selectAdaptiveDays(
  db: Database,
  params: SelectAdaptiveDaysParams,
): SelectAdaptiveDaysResult[] {
  const sql = `
	SELECT day
	FROM days
	WHERE user_id = ? AND day >= ? AND day <= ?
	  AND signed_off_at IS NOT NULL
	ORDER BY day;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.start, params.end]);

  return rows.map((data) => mapArrayToSelectAdaptiveDaysResult(data));
}

function mapArrayToSelectAdaptiveDaysResult(data: any) {
  const result: SelectAdaptiveDaysResult = {
    day: data[0],
  };
  return result;
}
