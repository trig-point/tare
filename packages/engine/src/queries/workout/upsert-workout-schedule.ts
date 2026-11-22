import type { Database } from "better-sqlite3";

export type UpsertWorkoutScheduleParams = {
  user_id: number | null;
  document: string;
  updated_at: string;
};

export type UpsertWorkoutScheduleResult = {
  user_id: number;
  document: string;
  updated_at: string;
};

export function upsertWorkoutSchedule(
  db: Database,
  params: UpsertWorkoutScheduleParams,
): UpsertWorkoutScheduleResult | null {
  const sql = `
	INSERT INTO workout_schedules (user_id, document, updated_at)
	VALUES (?, ?, ?)
	ON CONFLICT (user_id) DO UPDATE SET
	  document = excluded.document,
	  updated_at = excluded.updated_at
	RETURNING user_id, document, updated_at;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.document, params.updated_at]);

  return res ? mapArrayToUpsertWorkoutScheduleResult(res) : null;
}

function mapArrayToUpsertWorkoutScheduleResult(data: any) {
  const result: UpsertWorkoutScheduleResult = {
    user_id: data[0],
    document: data[1],
    updated_at: data[2],
  };
  return result;
}
