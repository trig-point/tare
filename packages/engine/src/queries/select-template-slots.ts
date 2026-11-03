import type { Database } from "better-sqlite3";

export type SelectTemplateSlotsParams = {
  user_id: number;
  template_id: number;
};

export type SelectTemplateSlotsResult = {
  user_id: number;
  template_id: number;
  position: number;
  name: string;
  start_minute: number;
  end_minute: number;
  share_bp: number;
  fill_hint: string | null;
};

export function selectTemplateSlots(
  db: Database,
  params: SelectTemplateSlotsParams,
): SelectTemplateSlotsResult[] {
  const sql = `
	SELECT user_id, template_id, position, name, start_minute, end_minute, share_bp, fill_hint
	FROM template_slots WHERE user_id = ? AND template_id = ?
	ORDER BY position;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.template_id]);

  return rows.map((data) => mapArrayToSelectTemplateSlotsResult(data));
}

function mapArrayToSelectTemplateSlotsResult(data: any) {
  const result: SelectTemplateSlotsResult = {
    user_id: data[0],
    template_id: data[1],
    position: data[2],
    name: data[3],
    start_minute: data[4],
    end_minute: data[5],
    share_bp: data[6],
    fill_hint: data[7],
  };
  return result;
}
