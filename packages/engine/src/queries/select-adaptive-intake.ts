import type { Database } from "better-sqlite3";

export type SelectAdaptiveIntakeParams = {
  user_id: number;
  start: string;
  end: string;
};

export type SelectAdaptiveIntakeResult = {
  day: string;
  kcal: number | null;
  kcal_low: number | null;
  kcal_high: number | null;
  provenance: string;
};

export function selectAdaptiveIntake(
  db: Database,
  params: SelectAdaptiveIntakeParams,
): SelectAdaptiveIntakeResult[] {
  const sql = `
	SELECT intake_entries.day, kcal, kcal_low, kcal_high, provenance
	FROM days
	JOIN intake_entries ON intake_entries.user_id = days.user_id AND intake_entries.day = days.day
	WHERE days.user_id = ? AND days.day >= ? AND days.day <= ?
	  AND days.signed_off_at IS NOT NULL
	ORDER BY intake_entries.day, intake_entries.id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.start, params.end]);

  return rows.map((data) => mapArrayToSelectAdaptiveIntakeResult(data));
}

function mapArrayToSelectAdaptiveIntakeResult(data: any) {
  const result: SelectAdaptiveIntakeResult = {
    day: data[0],
    kcal: data[1],
    kcal_low: data[2],
    kcal_high: data[3],
    provenance: data[4],
  };
  return result;
}
