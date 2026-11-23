import type { Database } from "better-sqlite3";

export type EndRevisionData = {
  effective_to: string | null;
};

export type EndRevisionParams = {
  id: number;
};

export type EndRevisionResult = {
  changes: number;
};

export function endRevision(
  db: Database,
  data: EndRevisionData,
  params: EndRevisionParams,
): EndRevisionResult {
  const sql = `
	UPDATE medication_schedule_revisions SET effective_to = ? WHERE id = ?
	
	`;
  return db
    .prepare(sql)
    .run([data.effective_to, params.id]) as EndRevisionResult;
}
