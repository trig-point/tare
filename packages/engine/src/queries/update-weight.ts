import type { Database } from "better-sqlite3";

export type UpdateWeightData = {
  measured_at: string;
  day: string;
  weight_kg: number;
  body_fat_pct: number | null;
};

export type UpdateWeightParams = {
  user_id: number;
  id: number;
};

export type UpdateWeightResult = {
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

export function updateWeight(
  db: Database,
  data: UpdateWeightData,
  params: UpdateWeightParams,
): UpdateWeightResult[] {
  const sql = `
	UPDATE weights SET measured_at = ?, day = ?, weight_kg = ?, body_fat_pct = ? WHERE user_id = ? AND id = ? RETURNING *;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.measured_at,
      data.day,
      data.weight_kg,
      data.body_fat_pct,
      params.user_id,
      params.id,
    ]);

  return rows.map((data) => mapArrayToUpdateWeightResult(data));
}

function mapArrayToUpdateWeightResult(data: any) {
  const result: UpdateWeightResult = {
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
