import type { Database } from "better-sqlite3";

export type UpdateDoseData = {
  status: string;
  taken_at: string | null;
  resolved_at: string | null;
  skip_reason: string | null;
  scheduled_at: string;
  water_ml: number | null;
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
  resolved_at: string | null;
  skip_reason: string | null;
  water_ml: number | null;
};

export function updateDose(
  db: Database,
  data: UpdateDoseData,
  params: UpdateDoseParams,
): UpdateDoseResult[] {
  const sql = `
	UPDATE medication_doses
	SET status = ?, taken_at = ?, resolved_at = ?, skip_reason = ?, scheduled_at = ?, water_ml = ?
	WHERE id = ?
	RETURNING *
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.status,
      data.taken_at,
      data.resolved_at,
      data.skip_reason,
      data.scheduled_at,
      data.water_ml,
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
    resolved_at: data[10],
    skip_reason: data[11],
    water_ml: data[12],
  };
  return result;
}
