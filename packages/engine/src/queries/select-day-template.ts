import type { Database } from "better-sqlite3";

export type SelectDayTemplateParams = {
  user_id: number;
  id: number;
};

export type SelectDayTemplateResult = {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
};

export function selectDayTemplate(
  db: Database,
  params: SelectDayTemplateParams,
): SelectDayTemplateResult | null {
  const sql = `
	SELECT id, user_id, name, created_at FROM day_templates
	WHERE user_id = ? AND id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectDayTemplateResult(res) : null;
}

function mapArrayToSelectDayTemplateResult(data: any) {
  const result: SelectDayTemplateResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    created_at: data[3],
  };
  return result;
}
