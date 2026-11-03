import type { Database } from "better-sqlite3";

export type SelectSelectedDayTypeParams = {
  user_id: number;
  day: string;
};

export type SelectSelectedDayTypeResult = {
  id: number;
  user_id: number;
  name: string;
  template_id: number;
};

export function selectSelectedDayType(
  db: Database,
  params: SelectSelectedDayTypeParams,
): SelectSelectedDayTypeResult | null {
  const sql = `
	SELECT id, user_id, name, template_id FROM day_types
	WHERE user_id = ? AND id = COALESCE(
	  (SELECT day_type_id FROM day_type_choices WHERE user_id = ? AND day = ?),
	  (SELECT day_type_id FROM default_day_types WHERE user_id = ?)
	);
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.user_id, params.day, params.user_id]);

  return res ? mapArrayToSelectSelectedDayTypeResult(res) : null;
}

function mapArrayToSelectSelectedDayTypeResult(data: any) {
  const result: SelectSelectedDayTypeResult = {
    id: data[0],
    user_id: data[1],
    name: data[2],
    template_id: data[3],
  };
  return result;
}
