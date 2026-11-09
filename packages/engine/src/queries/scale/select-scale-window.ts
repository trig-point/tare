import type { Database } from "better-sqlite3";

export type SelectScaleWindowParams = {
  user_id: number;
  from: string;
  to: string;
};

export type SelectScaleWindowResult = {
  id: number;
};

export function selectScaleWindow(
  db: Database,
  params: SelectScaleWindowParams,
): SelectScaleWindowResult | null {
  const sql = `
	SELECT id FROM weights
	WHERE user_id = ? AND source = 'scale'
	  AND measured_at BETWEEN ? AND ?
	LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.from, params.to]);

  return res ? mapArrayToSelectScaleWindowResult(res) : null;
}

function mapArrayToSelectScaleWindowResult(data: any) {
  const result: SelectScaleWindowResult = {
    id: data[0],
  };
  return result;
}
