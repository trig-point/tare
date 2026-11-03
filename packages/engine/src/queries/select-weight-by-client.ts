import type { Database } from "better-sqlite3";

export type SelectWeightByClientParams = {
  user_id: number;
  client_id: string;
};

export type SelectWeightByClientResult = {
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

export function selectWeightByClient(
  db: Database,
  params: SelectWeightByClientParams,
): SelectWeightByClientResult | null {
  const sql = `
	SELECT * FROM weights WHERE user_id = ? AND client_id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.client_id]);

  return res ? mapArrayToSelectWeightByClientResult(res) : null;
}

function mapArrayToSelectWeightByClientResult(data: any) {
  const result: SelectWeightByClientResult = {
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
