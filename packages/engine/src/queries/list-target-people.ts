import type { Database } from "better-sqlite3";

export type ListTargetPeopleResult = {
  user_id: number;
};

export function listTargetPeople(db: Database): ListTargetPeopleResult[] {
  const sql = `
	SELECT user_id FROM profiles ORDER BY user_id;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToListTargetPeopleResult(data));
}

function mapArrayToListTargetPeopleResult(data: any) {
  const result: ListTargetPeopleResult = {
    user_id: data[0],
  };
  return result;
}
