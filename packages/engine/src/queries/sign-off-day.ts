import type { Database } from "better-sqlite3";

export type SignOffDayParams = {
  user_id: number | null;
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
  set_hunger: number;
  set_fullness: number;
  set_notes: number;
};

export type SignOffDayResult = {
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export function signOffDay(
  db: Database,
  params: SignOffDayParams,
): SignOffDayResult | null {
  const sql = `
	INSERT INTO days (user_id, day, signed_off_at, hunger, fullness, notes)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, day) DO UPDATE SET
	    signed_off_at = ?,
	    hunger = CASE WHEN ? THEN ? ELSE days.hunger END,
	    fullness = CASE WHEN ? THEN ? ELSE days.fullness END,
	    notes = CASE WHEN ? THEN ? ELSE days.notes END
	RETURNING day, signed_off_at, hunger, fullness, notes;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.signed_off_at,
      params.hunger,
      params.fullness,
      params.notes,
      params.signed_off_at,
      params.set_hunger,
      params.hunger,
      params.set_fullness,
      params.fullness,
      params.set_notes,
      params.notes,
    ]);

  return res ? mapArrayToSignOffDayResult(res) : null;
}

function mapArrayToSignOffDayResult(data: any) {
  const result: SignOffDayResult = {
    day: data[0],
    signed_off_at: data[1],
    hunger: data[2],
    fullness: data[3],
    notes: data[4],
  };
  return result;
}
