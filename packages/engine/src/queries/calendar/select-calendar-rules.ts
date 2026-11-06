import type { Database } from "better-sqlite3";

export type SelectCalendarRulesParams = {
  user_id: number;
};

export type SelectCalendarRulesResult = {
  keyword: string;
  day_type_id: number;
};

export function selectCalendarRules(
  db: Database,
  params: SelectCalendarRulesParams,
): SelectCalendarRulesResult[] {
  const sql = `
	SELECT keyword, day_type_id FROM calendar_rules WHERE user_id = ? ORDER BY position;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectCalendarRulesResult(data));
}

function mapArrayToSelectCalendarRulesResult(data: any) {
  const result: SelectCalendarRulesResult = {
    keyword: data[0],
    day_type_id: data[1],
  };
  return result;
}
