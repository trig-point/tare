import type { Database } from "better-sqlite3";

export type UpsertParams = {
  id: number | null;
  label: string;
};

export type UpsertResult = {
  id: number;
  label: string;
};

export function upsert(
  db: Database,
  params: UpsertParams,
): UpsertResult | null {
  const sql = `
	INSERT INTO compat_items (id, label) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET label = excluded.label RETURNING id, label;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.id, params.label]);

  return res ? mapArrayToUpsertResult(res) : null;
}

function mapArrayToUpsertResult(data: any) {
  const result: UpsertResult = {
    id: data[0],
    label: data[1],
  };
  return result;
}
