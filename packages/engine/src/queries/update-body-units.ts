import type { Database } from "better-sqlite3";

export type UpdateBodyUnitsData = {
  body_units: string;
};

export type UpdateBodyUnitsParams = {
  user_id: number;
};

export type UpdateBodyUnitsResult = {
  body_units: string;
};

export function updateBodyUnits(
  db: Database,
  data: UpdateBodyUnitsData,
  params: UpdateBodyUnitsParams,
): UpdateBodyUnitsResult[] {
  const sql = `
	UPDATE users SET body_units = ? WHERE id = ?
	RETURNING body_units;
	
	`;
  const rows = db.prepare(sql).raw(true).all([data.body_units, params.user_id]);

  return rows.map((data) => mapArrayToUpdateBodyUnitsResult(data));
}

function mapArrayToUpdateBodyUnitsResult(data: any) {
  const result: UpdateBodyUnitsResult = {
    body_units: data[0],
  };
  return result;
}
