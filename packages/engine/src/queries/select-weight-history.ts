import type { Database } from "better-sqlite3";

export type SelectWeightHistoryParams = {
  user_id: number;
};

export type SelectWeightHistoryResult = {
  day: string;
  measured_at: string;
  id: number;
  weight_kg: number;
};

export function selectWeightHistory(
  db: Database,
  params: SelectWeightHistoryParams,
): SelectWeightHistoryResult[] {
  const sql = `
	SELECT day, measured_at, id, weight_kg
	FROM weights
	WHERE user_id = ?
	ORDER BY day, measured_at, id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectWeightHistoryResult(data));
}

function mapArrayToSelectWeightHistoryResult(data: any) {
  const result: SelectWeightHistoryResult = {
    day: data[0],
    measured_at: data[1],
    id: data[2],
    weight_kg: data[3],
  };
  return result;
}
