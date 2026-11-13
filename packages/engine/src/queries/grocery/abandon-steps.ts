import type { Database } from "better-sqlite3";

export type AbandonStepsData = {
  now: string;
};

export type AbandonStepsParams = {
  request_id: number;
};

export type AbandonStepsResult = {
  changes: number;
};

export function abandonSteps(
  db: Database,
  data: AbandonStepsData,
  params: AbandonStepsParams,
): AbandonStepsResult {
  const sql = `
	UPDATE grocery_steps SET state = 'abandoned', updated_at = ? WHERE request_id = ? AND state IN ('pending', 'uncertain');
	
	`;
  return db
    .prepare(sql)
    .run([data.now, params.request_id]) as AbandonStepsResult;
}
