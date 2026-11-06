import type { Database } from "better-sqlite3";

export type SelectCalendarOwnersResult = {
  user_id: number;
};

export function selectCalendarOwners(
  db: Database,
): SelectCalendarOwnersResult[] {
  const sql = `
	SELECT user_id FROM calendar_settings WHERE enabled = 1;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToSelectCalendarOwnersResult(data));
}

function mapArrayToSelectCalendarOwnersResult(data: any) {
  const result: SelectCalendarOwnersResult = {
    user_id: data[0],
  };
  return result;
}
