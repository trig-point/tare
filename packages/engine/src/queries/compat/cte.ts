import type { Database } from "better-sqlite3";

export type CteParams = {
  minimum: number;
};

export type CteResult = {
  id: number;
  label: string;
};

export function cte(db: Database, params: CteParams): CteResult[] {
  const sql = `
	WITH selected AS (SELECT id, label FROM compat_items WHERE id >= ?) SELECT id, label FROM selected ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.minimum]);

  return rows.map((data) => mapArrayToCteResult(data));
}

function mapArrayToCteResult(data: any) {
  const result: CteResult = {
    id: data[0],
    label: data[1],
  };
  return result;
}
