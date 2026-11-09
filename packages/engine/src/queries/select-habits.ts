import type { Database } from "better-sqlite3";

export type SelectHabitsParams = {
  user_id: number;
  day: string;
};

export type SelectHabitsResult = {
  habit_key: string;
  amount: number | null;
  note: string | null;
  source: string;
  updated_at: string;
};

export function selectHabits(
  db: Database,
  params: SelectHabitsParams,
): SelectHabitsResult[] {
  const sql = `
	SELECT habit_key, amount, note, source, updated_at FROM habit_log
	WHERE user_id = ? AND day = ? ORDER BY habit_key;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.day]);

  return rows.map((data) => mapArrayToSelectHabitsResult(data));
}

function mapArrayToSelectHabitsResult(data: any) {
  const result: SelectHabitsResult = {
    habit_key: data[0],
    amount: data[1],
    note: data[2],
    source: data[3],
    updated_at: data[4],
  };
  return result;
}
