import type { Database } from "better-sqlite3";

export type SelectUserParams = {
  id: number;
};

export type SelectUserResult = {
  id: number;
  username: string;
  password_hash: string | null;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
  created_at: string;
  access_email: string | null;
};

export function selectUser(
  db: Database,
  params: SelectUserParams,
): SelectUserResult | null {
  const sql = `
	SELECT * FROM users WHERE id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.id]);

  return res ? mapArrayToSelectUserResult(res) : null;
}

function mapArrayToSelectUserResult(data: any) {
  const result: SelectUserResult = {
    id: data[0],
    username: data[1],
    password_hash: data[2],
    timezone: data[3],
    day_start_hour: data[4],
    is_admin: data[5],
    created_at: data[6],
    access_email: data[7],
  };
  return result;
}
