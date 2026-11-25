import type { Database } from "better-sqlite3";

export type ListActivityEventsAfterParams = {
  user_id: number;
  after_id: number;
};

export type ListActivityEventsAfterResult = {
  id: number;
  payload: string;
};

export function listActivityEventsAfter(
  db: Database,
  params: ListActivityEventsAfterParams,
): ListActivityEventsAfterResult[] {
  const sql = `
	SELECT id, payload FROM activity_events
	WHERE (user_id = ? OR user_id IS NULL) AND id > ? ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.after_id]);

  return rows.map((data) => mapArrayToListActivityEventsAfterResult(data));
}

function mapArrayToListActivityEventsAfterResult(data: any) {
  const result: ListActivityEventsAfterResult = {
    id: data[0],
    payload: data[1],
  };
  return result;
}
