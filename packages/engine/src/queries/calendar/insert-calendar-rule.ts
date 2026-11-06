import type { Database } from "better-sqlite3";

export type InsertCalendarRuleParams = {
  user_id: number | null;
  position: number | null;
  keyword: string;
  day_type_id: number;
};

export type InsertCalendarRuleResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertCalendarRule(
  db: Database,
  params: InsertCalendarRuleParams,
): InsertCalendarRuleResult {
  const sql = `
	INSERT INTO calendar_rules (user_id, position, keyword, day_type_id)
	VALUES (?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.position,
      params.keyword,
      params.day_type_id,
    ]) as InsertCalendarRuleResult;
}
