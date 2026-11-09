import type { Database } from "better-sqlite3";

export type UpdateSlotShareData = {
  share_bp: number;
};

export type UpdateSlotShareParams = {
  user_id: number;
  template_id: number;
  position: number;
};

export type UpdateSlotShareResult = {
  position: number;
};

export function updateSlotShare(
  db: Database,
  data: UpdateSlotShareData,
  params: UpdateSlotShareParams,
): UpdateSlotShareResult[] {
  const sql = `
	UPDATE template_slots SET share_bp = ?
	WHERE user_id = ? AND template_id = ? AND position = ?
	RETURNING position;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.share_bp, params.user_id, params.template_id, params.position]);

  return rows.map((data) => mapArrayToUpdateSlotShareResult(data));
}

function mapArrayToUpdateSlotShareResult(data: any) {
  const result: UpdateSlotShareResult = {
    position: data[0],
  };
  return result;
}
