import type { Database } from "better-sqlite3";

export type SelectLastActivityEventResult = {
  id: number;
};

export function selectLastActivityEvent(
  db: Database,
): SelectLastActivityEventResult | null {
  const sql = `
	SELECT coalesce(max(id), 0) AS id FROM activity_events;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToSelectLastActivityEventResult(res) : null;
}

function mapArrayToSelectLastActivityEventResult(data: any) {
  const result: SelectLastActivityEventResult = {
    id: data[0],
  };
  return result;
}
