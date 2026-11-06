import type { Database } from "better-sqlite3";

export type DeleteCalendarRulesParams = {
  user_id: number;
};

export type DeleteCalendarRulesResult = {
  changes: number;
};

export function deleteCalendarRules(
  db: Database,
  params: DeleteCalendarRulesParams,
): DeleteCalendarRulesResult {
  const sql = `
	DELETE FROM calendar_rules WHERE user_id = ?;
	
	`;
  return db.prepare(sql).run([params.user_id]) as DeleteCalendarRulesResult;
}
