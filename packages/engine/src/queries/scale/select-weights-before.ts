import type { Database } from "better-sqlite3";

export type SelectWeightsBeforeParams = {
  user_id: number;
  day: string;
  measured_at: string;
};

export type SelectWeightsBeforeResult = {
  day: string;
  measured_at: string;
  id: number;
  weight_kg: number;
};

export function selectWeightsBefore(
  db: Database,
  params: SelectWeightsBeforeParams,
): SelectWeightsBeforeResult[] {
  const sql = `
	SELECT day, measured_at, id, weight_kg
	FROM weights
	WHERE user_id = ? AND day <= ? AND measured_at < ?
	ORDER BY day, measured_at, id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.day, params.measured_at]);

  return rows.map((data) => mapArrayToSelectWeightsBeforeResult(data));
}

function mapArrayToSelectWeightsBeforeResult(data: any) {
  const result: SelectWeightsBeforeResult = {
    day: data[0],
    measured_at: data[1],
    id: data[2],
    weight_kg: data[3],
  };
  return result;
}
