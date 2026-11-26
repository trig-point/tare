import type { Database } from "better-sqlite3";

export type SelectDayReceiptParams = {
  user_id: number;
  day: string;
  start: string;
  end: string;
};

export type SelectDayReceiptResult = {
  client_id: string;
};

export function selectDayReceipt(
  db: Database,
  params: SelectDayReceiptParams,
): SelectDayReceiptResult | null {
  const sql = `
	SELECT client_id FROM scale_readings
	WHERE user_id = ? AND day = ?
	UNION ALL
	SELECT client_id FROM scale_readings
	WHERE user_id = ? AND day IS NULL
	  AND possible_measured_at >= ? AND possible_measured_at < ?
	LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.user_id,
      params.start,
      params.end,
    ]);

  return res ? mapArrayToSelectDayReceiptResult(res) : null;
}

function mapArrayToSelectDayReceiptResult(data: any) {
  const result: SelectDayReceiptResult = {
    client_id: data[0],
  };
  return result;
}
