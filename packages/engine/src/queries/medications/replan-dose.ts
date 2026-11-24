import type { Database } from "better-sqlite3";

export type ReplanDoseData = {
  revision_id: number;
  slot_at: string;
  scheduled_at: string;
};

export type ReplanDoseParams = {
  id: number;
};

export type ReplanDoseResult = {
  changes: number;
};

export function replanDose(
  db: Database,
  data: ReplanDoseData,
  params: ReplanDoseParams,
): ReplanDoseResult {
  const sql = `
	UPDATE medication_doses
	SET revision_id = ?, slot_at = ?, scheduled_at = ?
	WHERE id = ? AND status = 'scheduled'
	
	`;
  return db
    .prepare(sql)
    .run([
      data.revision_id,
      data.slot_at,
      data.scheduled_at,
      params.id,
    ]) as ReplanDoseResult;
}
