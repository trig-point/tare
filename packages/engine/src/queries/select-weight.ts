import type { Database } from "better-sqlite3";

export type SelectWeightParams = {
  user_id: number;
  id: number;
};

export type SelectWeightResult = {
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

export function selectWeight(
  db: Database,
  params: SelectWeightParams,
): SelectWeightResult | null {
  const sql = `
	SELECT * FROM weights WHERE user_id = ? AND id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectWeightResult(res) : null;
}

function mapArrayToSelectWeightResult(data: any) {
  const result: SelectWeightResult = {
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
