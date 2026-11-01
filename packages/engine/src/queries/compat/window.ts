import type { Database } from "better-sqlite3";

export type WindowResult = {
  id: number;
  position: number;
};

export function window(db: Database): WindowResult[] {
  const sql = `
	SELECT id, row_number() OVER (ORDER BY id) AS position FROM compat_items ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToWindowResult(data));
}

function mapArrayToWindowResult(data: any) {
  const result: WindowResult = {
    id: data[0],
    position: data[1],
  };
  return result;
}
