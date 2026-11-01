import type { Database } from "better-sqlite3";

export type SelectUserByUsernameParams = {
  username: string;
};

export type SelectUserByUsernameResult = {
  id: number;
  username: string;
  password_hash: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
};

export function selectUserByUsername(
  db: Database,
  params: SelectUserByUsernameParams,
): SelectUserByUsernameResult | null {
  const sql = `
	SELECT id, username, password_hash, timezone, day_start_hour, is_admin
	FROM users WHERE username = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.username]);

  return res ? mapArrayToSelectUserByUsernameResult(res) : null;
}

function mapArrayToSelectUserByUsernameResult(data: any) {
  const result: SelectUserByUsernameResult = {
    id: data[0],
    username: data[1],
    password_hash: data[2],
    timezone: data[3],
    day_start_hour: data[4],
    is_admin: data[5],
  };
  return result;
}
