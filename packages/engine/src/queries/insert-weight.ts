import type { Database } from "better-sqlite3";

export type InsertWeightParams = {
  user_id: number;
  client_id: string;
  measured_at: string;
  day: string;
  weight_kg: number;
  body_fat_pct: number | null;
  source: string | null;
  created_at: string;
};

export type InsertWeightResult = {
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

export function insertWeight(
  db: Database,
  params: InsertWeightParams,
): InsertWeightResult | null {
  const sql = `
	INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, body_fat_pct, source, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.client_id,
      params.measured_at,
      params.day,
      params.weight_kg,
      params.body_fat_pct,
      params.source,
      params.created_at,
    ]);

  return res ? mapArrayToInsertWeightResult(res) : null;
}

function mapArrayToInsertWeightResult(data: any) {
  const result: InsertWeightResult = {
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
