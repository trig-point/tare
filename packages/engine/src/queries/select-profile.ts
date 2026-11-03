import type { Database } from "better-sqlite3";

export type SelectProfileParams = {
  user_id: number;
};

export type SelectProfileResult = {
  user_id: number;
  height_cm: number;
  birth_date: string;
  sex: string;
  activity_level: string;
  goal_rate_kg_week: number;
  protein_factor: number;
  updated_at: string;
};

export function selectProfile(
  db: Database,
  params: SelectProfileParams,
): SelectProfileResult | null {
  const sql = `
	SELECT user_id, height_cm, birth_date, sex, activity_level, goal_rate_kg_week, protein_factor, updated_at
	FROM profiles
	WHERE user_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectProfileResult(res) : null;
}

function mapArrayToSelectProfileResult(data: any) {
  const result: SelectProfileResult = {
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
