import type { Database } from "better-sqlite3";

export type CountUsersResult = {
  count: number;
};

export function countUsers(db: Database): CountUsersResult | null {
  const sql = `
	SELECT COUNT(*) AS count FROM users;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToCountUsersResult(res) : null;
}

function mapArrayToCountUsersResult(data: any) {
  const result: CountUsersResult = {
    count: data[0],
  };
  return result;
}
