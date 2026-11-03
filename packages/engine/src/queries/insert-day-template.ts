import type { Database } from "better-sqlite3";

export type InsertDayTemplateParams = {
  user_id: number;
  name: string;
  created_at: string;
};

export type InsertDayTemplateResult = {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
};

export function insertDayTemplate(
  db: Database,
  params: InsertDayTemplateParams,
): InsertDayTemplateResult | null {
  const sql = `
	INSERT INTO day_templates (user_id, name, created_at)
	VALUES (?, ?, ?) RETURNING id, user_id, name, created_at;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.name, params.created_at]);

  return res ? mapArrayToInsertDayTemplateResult(res) : null;
}

function mapArrayToInsertDayTemplateResult(data: any) {
  const result: InsertDayTemplateResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    created_at: data[3],
  };
  return result;
}
