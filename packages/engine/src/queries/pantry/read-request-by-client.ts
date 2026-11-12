import type { Database } from "better-sqlite3";

export type ReadRequestByClientParams = {
  user_id: number;
  client_id: string;
};

export type ReadRequestByClientResult = {
  id: string;
};

export function readRequestByClient(
  db: Database,
  params: ReadRequestByClientParams,
): ReadRequestByClientResult[] {
  const sql = `
	SELECT id FROM pantry_requests WHERE user_id = ? AND client_id = ?;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.client_id]);

  return rows.map((data) => mapArrayToReadRequestByClientResult(data));
}

function mapArrayToReadRequestByClientResult(data: any) {
  const result: ReadRequestByClientResult = {
    id: data[0],
  };
  return result;
}
