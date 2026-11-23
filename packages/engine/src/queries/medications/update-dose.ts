import type { Database } from "better-sqlite3";

export type UpdateDoseData = {
  status: string;
  taken_at: string | null;
  skip_reason: string | null;
  scheduled_at: string;
};

export type UpdateDoseParams = {
  id: number;
};

export type UpdateDoseResult = {
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
  skip_reason: string | null;
};

export function updateDose(
  db: Database,
  data: UpdateDoseData,
  params: UpdateDoseParams,
): UpdateDoseResult[] {
  const sql = `
	UPDATE medication_doses
	SET status = ?, taken_at = ?, skip_reason = ?, scheduled_at = ?
	WHERE id = ?
	RETURNING *
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.status,
      data.taken_at,
      data.skip_reason,
      data.scheduled_at,
      params.id,
    ]);

  return rows.map((data) => mapArrayToUpdateDoseResult(data));
}

function mapArrayToUpdateDoseResult(data: any) {
  const result: UpdateDoseResult = {
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
    skip_reason: data[10],
  };
  return result;
}
