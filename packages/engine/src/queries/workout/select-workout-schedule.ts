import type { Database } from "better-sqlite3";

export type SelectWorkoutScheduleParams = {
  user_id: number;
};

export type SelectWorkoutScheduleResult = {
  user_id: number;
  document: string;
  updated_at: string;
};

export function selectWorkoutSchedule(
  db: Database,
  params: SelectWorkoutScheduleParams,
): SelectWorkoutScheduleResult | null {
  const sql = `
	SELECT user_id, document, updated_at
	FROM workout_schedules
	WHERE user_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectWorkoutScheduleResult(res) : null;
}

function mapArrayToSelectWorkoutScheduleResult(data: any) {
  const result: SelectWorkoutScheduleResult = {
    user_id: data[0],
    document: data[1],
    updated_at: data[2],
  };
  return result;
}
