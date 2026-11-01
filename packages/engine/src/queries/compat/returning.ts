import type { Database } from "better-sqlite3";

export type ReturningData = {
  label: string;
};

export type ReturningParams = {
  minimum: number;
};

export type ReturningResult = {
  id: number;
  label: string;
};

export function returning(
  db: Database,
  data: ReturningData,
  params: ReturningParams,
): ReturningResult[] {
  const sql = `
	UPDATE compat_items SET label = ? WHERE id >= ? RETURNING id, label;
	
	`;
  const rows = db.prepare(sql).raw(true).all([data.label, params.minimum]);

  return rows.map((data) => mapArrayToReturningResult(data));
}

function mapArrayToReturningResult(data: any) {
  const result: ReturningResult = {
    id: data[0],
    label: data[1],
  };
  return result;
}
