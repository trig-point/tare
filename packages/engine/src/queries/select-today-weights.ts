import type { Database } from "better-sqlite3";

export type SelectTodayWeightsParams = {
  user_id: number;
  day: string;
};

export type SelectTodayWeightsResult = {
  user_id: number;
  id: number;
  client_id: string;
  measured_at: string;
  day: string;
  weight_kg: number;
  body_fat_pct: number | null;
  source: string | null;
  created_at: string;
};

export function selectTodayWeights(
  db: Database,
  params: SelectTodayWeightsParams,
): SelectTodayWeightsResult[] {
  const sql = `
	SELECT * FROM weights
	WHERE user_id = ? AND day = ?
	ORDER BY measured_at, id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.day]);

  return rows.map((data) => mapArrayToSelectTodayWeightsResult(data));
}

function mapArrayToSelectTodayWeightsResult(data: any) {
  const result: SelectTodayWeightsResult = {
    user_id: data[0],
    id: data[1],
    client_id: data[2],
    measured_at: data[3],
    day: data[4],
    weight_kg: data[5],
    body_fat_pct: data[6],
    source: data[7],
    created_at: data[8],
  };
  return result;
}
