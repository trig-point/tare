import type { Database } from "better-sqlite3";

export type SelectUserByAccessEmailParams = {
  access_email: string;
};

export type SelectUserByAccessEmailResult = {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
};

export function selectUserByAccessEmail(
  db: Database,
  params: SelectUserByAccessEmailParams,
): SelectUserByAccessEmailResult | null {
  const sql = `
	SELECT id, username, timezone, day_start_hour, is_admin
	FROM users WHERE access_email = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.access_email]);

  return res ? mapArrayToSelectUserByAccessEmailResult(res) : null;
}

function mapArrayToSelectUserByAccessEmailResult(data: any) {
  const result: SelectUserByAccessEmailResult = {
    id: data[0],
    username: data[1],
    timezone: data[2],
    day_start_hour: data[3],
    is_admin: data[4],
  };
  return result;
}
