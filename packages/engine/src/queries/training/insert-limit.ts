import type { Database } from "better-sqlite3";

export type InsertLimitParams = {
  user_id: number;
  body_area: string;
  description: string;
  movements: string;
  status: string;
  date_noted: string;
};

export type InsertLimitResult = {
  id: number;
  body_area: string;
  description: string;
  movements: string;
  status: string;
  date_noted: string;
};

export function insertLimit(
  db: Database,
  params: InsertLimitParams,
): InsertLimitResult | null {
  const sql = `
	INSERT INTO training_limits (user_id, body_area, description, movements, status, date_noted)
	VALUES (?, ?, ?, ?, ?, ?)
	RETURNING id, body_area, description, movements, status, date_noted;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.body_area,
      params.description,
      params.movements,
      params.status,
      params.date_noted,
    ]);

  return res ? mapArrayToInsertLimitResult(res) : null;
}

function mapArrayToInsertLimitResult(data: any) {
  const result: InsertLimitResult = {
    id: data[0],
    body_area: data[1],
    description: data[2],
    movements: data[3],
    status: data[4],
    date_noted: data[5],
  };
  return result;
}
