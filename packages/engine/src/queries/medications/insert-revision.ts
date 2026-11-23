import type { Database } from "better-sqlite3";

export type InsertRevisionParams = {
  medication_id: number;
  effective_from: string;
  effective_to: string | null;
  timezone: string;
  days: string;
  times: string;
};

export type InsertRevisionResult = {
  id: number;
  medication_id: number;
  effective_from: string;
  effective_to: string | null;
  timezone: string;
  days: string;
  times: string;
};

export function insertRevision(
  db: Database,
  params: InsertRevisionParams,
): InsertRevisionResult | null {
  const sql = `
	INSERT INTO medication_schedule_revisions
	  (medication_id, effective_from, effective_to, timezone, days, times)
	VALUES (?, ?, ?, ?, ?, ?)
	RETURNING *
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.medication_id,
      params.effective_from,
      params.effective_to,
      params.timezone,
      params.days,
      params.times,
    ]);

  return res ? mapArrayToInsertRevisionResult(res) : null;
}

function mapArrayToInsertRevisionResult(data: any) {
  const result: InsertRevisionResult = {
    id: data[0],
    medication_id: data[1],
    effective_from: data[2],
    effective_to: data[3],
    timezone: data[4],
    days: data[5],
    times: data[6],
  };
  return result;
}
