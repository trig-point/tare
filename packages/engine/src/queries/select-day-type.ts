import type { Database } from "better-sqlite3";

export type SelectDayTypeParams = {
  user_id: number;
  id: number;
};

export type SelectDayTypeResult = {
  id: number;
  user_id: number;
  name: string;
  template_id: number;
};

export function selectDayType(
  db: Database,
  params: SelectDayTypeParams,
): SelectDayTypeResult | null {
  const sql = `
	SELECT id, user_id, name, template_id FROM day_types
	WHERE user_id = ? AND id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectDayTypeResult(res) : null;
}

function mapArrayToSelectDayTypeResult(data: any) {
  const result: SelectDayTypeResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    template_id: data[3],
  };
  return result;
}
