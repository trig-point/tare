import type { Database } from "better-sqlite3";

export type SelectBodyUnitsParams = {
  user_id: number;
};

export type SelectBodyUnitsResult = {
  body_units: string;
};

export function selectBodyUnits(
  db: Database,
  params: SelectBodyUnitsParams,
): SelectBodyUnitsResult[] {
  const sql = `
	SELECT body_units FROM users WHERE id = ?;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectBodyUnitsResult(data));
}

function mapArrayToSelectBodyUnitsResult(data: any) {
  const result: SelectBodyUnitsResult = {
    body_units: data[0],
  };
  return result;
}
