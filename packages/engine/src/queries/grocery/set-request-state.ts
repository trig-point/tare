import type { Database } from "better-sqlite3";

export type SetRequestStateData = {
  state: string;
  now: string;
};

export type SetRequestStateParams = {
  id: number;
  expected_state: string;
};

export type SetRequestStateResult = {
  id: number;
};

export function setRequestState(
  db: Database,
  data: SetRequestStateData,
  params: SetRequestStateParams,
): SetRequestStateResult[] {
  const sql = `
	UPDATE grocery_requests SET state = ?, updated_at = ? WHERE id = ? AND state = ? RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.state, data.now, params.id, params.expected_state]);

  return rows.map((data) => mapArrayToSetRequestStateResult(data));
}

function mapArrayToSetRequestStateResult(data: any) {
  const result: SetRequestStateResult = {
    id: data[0],
  };
  return result;
}
