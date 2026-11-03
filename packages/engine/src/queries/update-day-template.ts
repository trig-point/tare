import type { Database } from "better-sqlite3";

export type UpdateDayTemplateData = {
  name: string;
};

export type UpdateDayTemplateParams = {
  user_id: number;
  id: number;
};

export type UpdateDayTemplateResult = {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
};

export function updateDayTemplate(
  db: Database,
  data: UpdateDayTemplateData,
  params: UpdateDayTemplateParams,
): UpdateDayTemplateResult | null {
  const sql = `
	UPDATE day_templates SET name = ? WHERE user_id = ? AND id = ?
	RETURNING id, user_id, name, created_at;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([data.name, params.user_id, params.id]);

  return res ? mapArrayToUpdateDayTemplateResult(res) : null;
}

function mapArrayToUpdateDayTemplateResult(data: any) {
  const result: UpdateDayTemplateResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    created_at: data[3],
  };
  return result;
}
