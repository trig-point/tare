import type { Database } from "better-sqlite3";

export type SelectFoundationParams = {
  id: number;
};

export type SelectFoundationResult = {
  id: number;
};

export function selectFoundation(
  db: Database,
  params: SelectFoundationParams,
): SelectFoundationResult | null {
  const sql = `
	SELECT id FROM foundation WHERE id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.id]);

  return res ? mapArrayToSelectFoundationResult(res) : null;
}

function mapArrayToSelectFoundationResult(data: any) {
  const result: SelectFoundationResult = {
    id: data[0],
  };
  return result;
}
