import type { Database } from "better-sqlite3";

export type CountSignInCapableUsersResult = {
  access_count: number;
  password_count: number;
};

export function countSignInCapableUsers(
  db: Database,
): CountSignInCapableUsersResult | null {
  const sql = `
	SELECT count(access_email) AS access_count, count(password_hash) AS password_count FROM users;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToCountSignInCapableUsersResult(res) : null;
}

function mapArrayToCountSignInCapableUsersResult(data: any) {
  const result: CountSignInCapableUsersResult = {
    access_count: data[0],
    password_count: data[1],
  };
  return result;
}
