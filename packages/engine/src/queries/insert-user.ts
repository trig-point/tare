import type { Database } from "better-sqlite3";

export type InsertUserParams = {
  username: string;
  password_hash: string;
  timezone: string;
  created_at: string;
};

export type InsertUserResult = {
  id: number;
  username: string;
  password_hash: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
  created_at: string;
};

export function insertUser(
  db: Database,
  params: InsertUserParams,
): InsertUserResult | null {
  const sql = `
	INSERT INTO users (username, password_hash, timezone, created_at)
	VALUES (?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.username,
      params.password_hash,
      params.timezone,
      params.created_at,
    ]);

  return res ? mapArrayToInsertUserResult(res) : null;
}

function mapArrayToInsertUserResult(data: any) {
  const result: InsertUserResult = {
    id: data[0],
    username: data[1],
    password_hash: data[2],
    timezone: data[3],
    day_start_hour: data[4],
    is_admin: data[5],
    created_at: data[6],
  };
  return result;
}
