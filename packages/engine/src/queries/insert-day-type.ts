import type { Database } from "better-sqlite3";

export type InsertDayTypeParams = {
  user_id: number;
  name: string;
  template_id: number;
};

export type InsertDayTypeResult = {
  id: number;
  user_id: number;
  name: string;
  template_id: number;
};

export function insertDayType(
  db: Database,
  params: InsertDayTypeParams,
): InsertDayTypeResult | null {
  const sql = `
	INSERT INTO day_types (user_id, name, template_id)
	VALUES (?, ?, ?) RETURNING id, user_id, name, template_id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.name, params.template_id]);

  return res ? mapArrayToInsertDayTypeResult(res) : null;
}

function mapArrayToInsertDayTypeResult(data: any) {
  const result: InsertDayTypeResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    template_id: data[3],
  };
  return result;
}
