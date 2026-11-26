import type { Database } from "better-sqlite3";

export type SelectScaleReadingParams = {
  client_id: string;
};

export type SelectScaleReadingResult = {
  day: string | null;
};

export function selectScaleReading(
  db: Database,
  params: SelectScaleReadingParams,
): SelectScaleReadingResult | null {
  const sql = `
	SELECT day FROM scale_readings WHERE client_id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.client_id]);

  return res ? mapArrayToSelectScaleReadingResult(res) : null;
}

function mapArrayToSelectScaleReadingResult(data: any) {
  const result: SelectScaleReadingResult = {
    day: data[0],
  };
  return result;
}
