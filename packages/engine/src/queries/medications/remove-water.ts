import type { Database } from "better-sqlite3";

export type RemoveWaterData = {
  amount: number;
  updated_at: string;
};

export type RemoveWaterParams = {
  user_id: number;
  day: string;
};

export type RemoveWaterResult = {
  changes: number;
};

export function removeWater(
  db: Database,
  data: RemoveWaterData,
  params: RemoveWaterParams,
): RemoveWaterResult {
  const sql = `
	UPDATE daily_signals SET value = max(0, value - ?), updated_at = ?
	WHERE user_id = ? AND day = ? AND metric = 'water' AND source = 'agent'
	
	`;
  return db
    .prepare(sql)
    .run([
      data.amount,
      data.updated_at,
      params.user_id,
      params.day,
    ]) as RemoveWaterResult;
}
