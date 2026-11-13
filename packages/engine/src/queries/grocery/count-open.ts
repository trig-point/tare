import type { Database } from "better-sqlite3";

export type CountOpenResult = {
  open: number;
};

export function countOpen(db: Database): CountOpenResult | null {
  const sql = `
	SELECT count(*) AS open FROM grocery_requests WHERE state IN ('open', 'binding_pending');
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToCountOpenResult(res) : null;
}

function mapArrayToCountOpenResult(data: any) {
  const result: CountOpenResult = {
    open: data[0],
  };
  return result;
}
