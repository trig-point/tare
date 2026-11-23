import type { Database } from "better-sqlite3";

export type ListDosesParams = {
  medication_id: number;
};

export type ListDosesResult = {
  id: number;
  public_key: string;
  medication_id: number;
  revision_id: number;
  slot_date: string;
  slot_time: string;
  slot_at: string;
  scheduled_at: string;
  status: string;
  taken_at: string | null;
  resolved_at: string | null;
  skip_reason: string | null;
};

export function listDoses(
  db: Database,
  params: ListDosesParams,
): ListDosesResult[] {
  const sql = `
	SELECT * FROM medication_doses WHERE medication_id = ? ORDER BY scheduled_at, id
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.medication_id]);

  return rows.map((data) => mapArrayToListDosesResult(data));
}

function mapArrayToListDosesResult(data: any) {
  const result: ListDosesResult = {
    id: data[0],
    public_key: data[1],
    medication_id: data[2],
    revision_id: data[3],
    slot_date: data[4],
    slot_time: data[5],
    slot_at: data[6],
    scheduled_at: data[7],
    status: data[8],
    taken_at: data[9],
    resolved_at: data[10],
    skip_reason: data[11],
  };
  return result;
}
