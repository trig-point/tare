import type { Database } from "better-sqlite3";

export type DeleteTemplateSlotsParams = {
  user_id: number;
  template_id: number;
};

export type DeleteTemplateSlotsResult = {
  changes: number;
};

export function deleteTemplateSlots(
  db: Database,
  params: DeleteTemplateSlotsParams,
): DeleteTemplateSlotsResult {
  const sql = `
	DELETE FROM template_slots WHERE user_id = ? AND template_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.template_id]) as DeleteTemplateSlotsResult;
}
