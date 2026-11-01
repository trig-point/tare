import type { Database } from "better-sqlite3";

export type InsertDayParams = {
  user_id: number | null;
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export type InsertDayResult = {
  user_id: number;
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export function insertDay(
  db: Database,
  params: InsertDayParams,
): InsertDayResult | null {
  const sql = `
	INSERT INTO days (user_id, day, signed_off_at, hunger, fullness, notes)
	VALUES (?, ?, ?, ?, ?, ?) RETURNING *;
	
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
    ]);

  return res ? mapArrayToInsertDayResult(res) : null;
}

function mapArrayToInsertDayResult(data: any) {
  const result: InsertDayResult = {
    user_id: data[0],
    day: data[1],
    signed_off_at: data[2],
    hunger: data[3],
    fullness: data[4],
    notes: data[5],
  };
  return result;
}
