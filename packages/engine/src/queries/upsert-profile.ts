import type { Database } from "better-sqlite3";

export type UpsertProfileParams = {
  user_id: number | null;
  height_cm: number;
  birth_date: string;
  sex: string;
  activity_level: string;
  goal_rate_kg_week: number;
  protein_factor: number;
  updated_at: string;
};

export type UpsertProfileResult = {
  user_id: number;
  height_cm: number;
  birth_date: string;
  sex: string;
  activity_level: string;
  goal_rate_kg_week: number;
  protein_factor: number;
  updated_at: string;
};

export function upsertProfile(
  db: Database,
  params: UpsertProfileParams,
): UpsertProfileResult | null {
  const sql = `
	INSERT INTO profiles (user_id, height_cm, birth_date, sex, activity_level, goal_rate_kg_week, protein_factor, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id) DO UPDATE SET
	  height_cm = excluded.height_cm,
	  birth_date = excluded.birth_date,
	  sex = excluded.sex,
	  activity_level = excluded.activity_level,
	  goal_rate_kg_week = excluded.goal_rate_kg_week,
	  protein_factor = excluded.protein_factor,
	  updated_at = excluded.updated_at
	RETURNING user_id, height_cm, birth_date, sex, activity_level, goal_rate_kg_week, protein_factor, updated_at;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.height_cm,
      params.birth_date,
      params.sex,
      params.activity_level,
      params.goal_rate_kg_week,
      params.protein_factor,
      params.updated_at,
    ]);

  return res ? mapArrayToUpsertProfileResult(res) : null;
}

function mapArrayToUpsertProfileResult(data: any) {
  const result: UpsertProfileResult = {
    user_id: data[0],
    height_cm: data[1],
    birth_date: data[2],
    sex: data[3],
    activity_level: data[4],
    goal_rate_kg_week: data[5],
    protein_factor: data[6],
    updated_at: data[7],
  };
  return result;
}
