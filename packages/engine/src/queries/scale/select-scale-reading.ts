import type { Database } from "better-sqlite3";

export type SelectScaleReadingParams = {
  client_id: string;
};

export type SelectScaleReadingResult = {
  client_id: string;
};

export function selectScaleReading(
  db: Database,
  params: SelectScaleReadingParams,
): SelectScaleReadingResult | null {
  const sql = `
	SELECT client_id FROM scale_readings WHERE client_id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.client_id]);

  return res ? mapArrayToSelectScaleReadingResult(res) : null;
}

function mapArrayToSelectScaleReadingResult(data: any) {
  const result: SelectScaleReadingResult = {
    client_id: data[0],
  };
  return result;
}
