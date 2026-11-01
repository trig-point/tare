import type { Database } from "better-sqlite3";

export type InsertAccountParams = {
  username: string;
  password_hash: string;
  timezone: string;
  is_admin: number;
  created_at: string;
};

export type InsertAccountResult = {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
  created_at: string;
};

export function insertAccount(
  db: Database,
  params: InsertAccountParams,
): InsertAccountResult | null {
  const sql = `
	INSERT INTO users (username, password_hash, timezone, is_admin, created_at)
	VALUES (?, ?, ?, ?, ?)
	RETURNING id, username, timezone, day_start_hour, is_admin, created_at;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.username,
      params.password_hash,
      params.timezone,
      params.is_admin,
      params.created_at,
    ]);

  return res ? mapArrayToInsertAccountResult(res) : null;
}

function mapArrayToInsertAccountResult(data: any) {
  const result: InsertAccountResult = {
    id: data[0],
    username: data[1],
    timezone: data[2],
    day_start_hour: data[3],
    is_admin: data[4],
    created_at: data[5],
  };
  return result;
}
