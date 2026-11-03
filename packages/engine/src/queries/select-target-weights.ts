import type { Database } from "better-sqlite3";

export type SelectTargetWeightsParams = {
  user_id: number;
  day: string;
};

export type SelectTargetWeightsResult = {
  day: string;
  measured_at: string;
  id: number;
  weight_kg: number;
};

export function selectTargetWeights(
  db: Database,
  params: SelectTargetWeightsParams,
): SelectTargetWeightsResult[] {
  const sql = `
	SELECT day, measured_at, id, weight_kg
	FROM weights
	WHERE user_id = ? AND day <= ?
	ORDER BY day, measured_at, id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.day]);

  return rows.map((data) => mapArrayToSelectTargetWeightsResult(data));
}

function mapArrayToSelectTargetWeightsResult(data: any) {
  const result: SelectTargetWeightsResult = {
    day: data[0],
    measured_at: data[1],
    id: data[2],
    weight_kg: data[3],
  };
  return result;
}
