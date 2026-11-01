import type { Database } from "better-sqlite3";

export type SelectSessionUserParams = {
  token_hash: string;
  now: string;
};

export type SelectSessionUserResult = {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
  expires_at: string;
};

export function selectSessionUser(
  db: Database,
  params: SelectSessionUserParams,
): SelectSessionUserResult | null {
  const sql = `
	SELECT users.id, users.username, users.timezone, users.day_start_hour, users.is_admin, sessions.expires_at
	FROM sessions INNER JOIN users ON users.id = sessions.user_id
	WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.token_hash, params.now]);

  return res ? mapArrayToSelectSessionUserResult(res) : null;
}

function mapArrayToSelectSessionUserResult(data: any) {
  const result: SelectSessionUserResult = {
    id: data[0],
    username: data[1],
    timezone: data[2],
    day_start_hour: data[3],
    is_admin: data[4],
    expires_at: data[5],
  };
  return result;
}
