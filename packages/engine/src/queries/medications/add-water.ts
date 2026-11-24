import type { Database } from "better-sqlite3";

export type AddWaterParams = {
  user_id: number | null;
  day: string;
  amount: number;
  updated_at: string;
};

export type AddWaterResult = {
  changes: number;
  lastInsertRowid: number;
};

export function addWater(db: Database, params: AddWaterParams): AddWaterResult {
  const sql = `
	INSERT INTO daily_signals (user_id, day, metric, value, source, updated_at)
	VALUES (?, ?, 'water', ?, 'agent', ?)
	ON CONFLICT (user_id, day, metric, source) DO UPDATE SET value = value + ?, updated_at = excluded.updated_at
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.day,
      params.amount,
      params.updated_at,
      params.amount,
    ]) as AddWaterResult;
}
