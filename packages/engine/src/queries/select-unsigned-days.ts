import type { Database } from "better-sqlite3";

export type SelectUnsignedDaysParams = {
  user_id: number;
  today: string;
};

export type SelectUnsignedDaysResult = {
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export function selectUnsignedDays(
  db: Database,
  params: SelectUnsignedDaysParams,
): SelectUnsignedDaysResult[] {
  const sql = `
	SELECT day, signed_off_at, hunger, fullness, notes FROM days
	WHERE user_id = ? AND signed_off_at IS NULL AND day < ?
	ORDER BY day DESC LIMIT 90;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.today]);

  return rows.map((data) => mapArrayToSelectUnsignedDaysResult(data));
}

function mapArrayToSelectUnsignedDaysResult(data: any) {
  const result: SelectUnsignedDaysResult = {
    day: data[0],
    signed_off_at: data[1],
    hunger: data[2],
    fullness: data[3],
    notes: data[4],
  };
  return result;
}
