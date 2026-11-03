import type { Database } from "better-sqlite3";

export type DeleteDayTemplateParams = {
  user_id: number;
  id: number;
};

export type DeleteDayTemplateResult = {
  id: number;
};

export function deleteDayTemplate(
  db: Database,
  params: DeleteDayTemplateParams,
): DeleteDayTemplateResult | null {
  const sql = `
	DELETE FROM day_templates WHERE user_id = ? AND id = ?
	RETURNING id;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToDeleteDayTemplateResult(res) : null;
}

function mapArrayToDeleteDayTemplateResult(data: any) {
  const result: DeleteDayTemplateResult = {
    id: data[0],
  };
  return result;
}
