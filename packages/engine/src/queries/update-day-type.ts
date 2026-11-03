import type { Database } from "better-sqlite3";

export type UpdateDayTypeData = {
  name: string;
  template_id: number;
};

export type UpdateDayTypeParams = {
  user_id: number;
  id: number;
};

export type UpdateDayTypeResult = {
  id: number;
  user_id: number;
  name: string;
  template_id: number;
};

export function updateDayType(
  db: Database,
  data: UpdateDayTypeData,
  params: UpdateDayTypeParams,
): UpdateDayTypeResult | null {
  const sql = `
	UPDATE day_types SET name = ?, template_id = ?
	WHERE user_id = ? AND id = ? RETURNING id, user_id, name, template_id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([data.name, data.template_id, params.user_id, params.id]);

  return res ? mapArrayToUpdateDayTypeResult(res) : null;
}

function mapArrayToUpdateDayTypeResult(data: any) {
  const result: UpdateDayTypeResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    template_id: data[3],
  };
  return result;
}
