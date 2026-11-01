import type { Database } from "better-sqlite3";

export type SelectDayParams = {
  user_id: number;
  day: string;
};

export type SelectDayResult = {
  user_id: number;
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export function selectDay(
  db: Database,
  params: SelectDayParams,
): SelectDayResult | null {
  const sql = `
	SELECT * FROM days WHERE user_id = ? AND day = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.day]);

  return res ? mapArrayToSelectDayResult(res) : null;
}

function mapArrayToSelectDayResult(data: any) {
  const result: SelectDayResult = {
    user_id: data[0],
    day: data[1],
    signed_off_at: data[2],
    hunger: data[3],
    fullness: data[4],
    notes: data[5],
  };
  return result;
}
