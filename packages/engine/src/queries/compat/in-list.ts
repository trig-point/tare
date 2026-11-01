import type { Database } from "better-sqlite3";

export type InListParams = {
  ids: number[];
};

export type InListResult = {
  id: number;
  label: string;
};

export function inList(db: Database, params: InListParams): InListResult[] {
  const sql = `
	SELECT id, label FROM compat_items WHERE id IN (${params.ids.map(() => "?")}) ORDER BY id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([...params.ids]);

  return rows.map((data) => mapArrayToInListResult(data));
}

function mapArrayToInListResult(data: any) {
  const result: InListResult = {
    id: data[0],
    label: data[1],
  };
  return result;
}
