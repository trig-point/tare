import type { Database } from "better-sqlite3";

export type DeleteHabitParams = {
  user_id: number;
  day: string;
  habit_key: string;
};

export type DeleteHabitResult = {
  day: string;
  habit_key: string;
};

export function deleteHabit(
  db: Database,
  params: DeleteHabitParams,
): DeleteHabitResult[] {
  const sql = `
	DELETE FROM habit_log WHERE user_id = ? AND day = ? AND habit_key = ? RETURNING day, habit_key;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.day, params.habit_key]);

  return rows.map((data) => mapArrayToDeleteHabitResult(data));
}

function mapArrayToDeleteHabitResult(data: any) {
  const result: DeleteHabitResult = {
    day: data[0],
    habit_key: data[1],
  };
  return result;
}
