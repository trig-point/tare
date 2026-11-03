import type { Database } from "better-sqlite3";

export type ClearIntakeSlotsParams = {
  user_id: number;
  template_id: number;
};

export type ClearIntakeSlotsResult = {
  changes: number;
};

export function clearIntakeSlots(
  db: Database,
  params: ClearIntakeSlotsParams,
): ClearIntakeSlotsResult {
  const sql = `
	UPDATE intake_entries SET slot_template_id = NULL, slot_position = NULL WHERE user_id = ? AND slot_template_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.template_id]) as ClearIntakeSlotsResult;
}
