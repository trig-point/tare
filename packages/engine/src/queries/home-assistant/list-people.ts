import type { Database } from "better-sqlite3";

export type ListPeopleResult = {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
};

export function listPeople(db: Database): ListPeopleResult[] {
  const sql = `
	SELECT id, username, timezone, day_start_hour, is_admin FROM users ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToListPeopleResult(data));
}

function mapArrayToListPeopleResult(data: any) {
  const result: ListPeopleResult = {
    id: data[0],
    username: data[1],
    timezone: data[2],
    day_start_hour: data[3],
    is_admin: data[4],
  };
  return result;
}
