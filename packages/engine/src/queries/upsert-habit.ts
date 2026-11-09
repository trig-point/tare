import type { Database } from "better-sqlite3";

export type UpsertHabitParams = {
  user_id: number | null;
  day: string;
  habit_key: string;
  amount: number | null;
  note: string | null;
  source: string;
  updated_at: string;
};

export type UpsertHabitResult = {
  user_id: number;
  day: string;
  habit_key: string;
  amount: number | null;
  note: string | null;
  source: string;
  updated_at: string;
};

export function upsertHabit(
  db: Database,
  params: UpsertHabitParams,
): UpsertHabitResult | null {
  const sql = `
	INSERT INTO habit_log (user_id, day, habit_key, amount, note, source, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, day, habit_key) DO UPDATE SET
	  amount = excluded.amount, note = excluded.note, source = excluded.source, updated_at = excluded.updated_at
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.habit_key,
      params.amount,
      params.note,
      params.source,
      params.updated_at,
    ]);

  return res ? mapArrayToUpsertHabitResult(res) : null;
}

function mapArrayToUpsertHabitResult(data: any) {
  const result: UpsertHabitResult = {
    user_id: data[0],
    day: data[1],
    habit_key: data[2],
    amount: data[3],
    note: data[4],
    source: data[5],
    updated_at: data[6],
  };
  return result;
}
