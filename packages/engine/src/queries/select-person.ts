import type { Database } from "better-sqlite3";

export type SelectPersonParams = {
  id: number;
};

export type SelectPersonResult = {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
};

export function selectPerson(
  db: Database,
  params: SelectPersonParams,
): SelectPersonResult | null {
  const sql = `
	SELECT id, username, timezone, day_start_hour, is_admin
	FROM users WHERE id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.id]);

  return res ? mapArrayToSelectPersonResult(res) : null;
}

function mapArrayToSelectPersonResult(data: any) {
  const result: SelectPersonResult = {
    id: data[0],
    username: data[1],
    timezone: data[2],
    day_start_hour: data[3],
    is_admin: data[4],
  };
  return result;
}
