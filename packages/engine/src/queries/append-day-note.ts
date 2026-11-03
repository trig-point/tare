import type { Database } from "better-sqlite3";

export type AppendDayNoteParams = {
  user_id: number | null;
  day: string;
  note: string | null;
};

export type AppendDayNoteResult = {
  day: string;
  signed_off_at: string | null;
  hunger: number | null;
  fullness: number | null;
  notes: string | null;
};

export function appendDayNote(
  db: Database,
  params: AppendDayNoteParams,
): AppendDayNoteResult | null {
  const sql = `
	INSERT INTO days (user_id, day, notes)
	VALUES (?, ?, ?)
	ON CONFLICT (user_id, day) DO UPDATE SET
	    notes = CASE WHEN days.notes IS NULL OR days.notes = '' THEN ?
	        ELSE days.notes || char(10) || ? END
	RETURNING day, signed_off_at, hunger, fullness, notes;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.day, params.note, params.note, params.note]);

  return res ? mapArrayToAppendDayNoteResult(res) : null;
}

function mapArrayToAppendDayNoteResult(data: any) {
  const result: AppendDayNoteResult = {
    day: data[0],
    signed_off_at: data[1],
    hunger: data[2],
    fullness: data[3],
    notes: data[4],
  };
  return result;
}
