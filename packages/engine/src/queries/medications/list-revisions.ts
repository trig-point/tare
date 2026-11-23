import type { Database } from "better-sqlite3";

export type ListRevisionsParams = {
  medication_id: number;
};

export type ListRevisionsResult = {
  id: number;
  medication_id: number;
  effective_from: string;
  effective_to: string | null;
  timezone: string;
  days: string;
  times: string;
};

export function listRevisions(
  db: Database,
  params: ListRevisionsParams,
): ListRevisionsResult[] {
  const sql = `
	SELECT * FROM medication_schedule_revisions WHERE medication_id = ?
	ORDER BY effective_from, id
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.medication_id]);

  return rows.map((data) => mapArrayToListRevisionsResult(data));
}

function mapArrayToListRevisionsResult(data: any) {
  const result: ListRevisionsResult = {
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
