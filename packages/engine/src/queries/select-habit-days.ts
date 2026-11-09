import type { Database } from "better-sqlite3";

export type SelectHabitDaysParams = {
  user_id: number;
  from: string;
  to: string;
};

export type SelectHabitDaysResult = {
  day: string;
  habit_key: string;
};

export function selectHabitDays(
  db: Database,
  params: SelectHabitDaysParams,
): SelectHabitDaysResult[] {
  const sql = `
	SELECT day, habit_key FROM habit_log
	WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day, habit_key;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.from, params.to]);

  return rows.map((data) => mapArrayToSelectHabitDaysResult(data));
}

function mapArrayToSelectHabitDaysResult(data: any) {
  const result: SelectHabitDaysResult = {
    day: data[0],
    habit_key: data[1],
  };
  return result;
}
