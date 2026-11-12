import type { Database } from "better-sqlite3";

export type CountUnresolvedRequestsResult = {
  unresolved: number;
};

export function countUnresolvedRequests(
  db: Database,
): CountUnresolvedRequestsResult | null {
  const sql = `
	SELECT count(*) AS unresolved FROM pantry_requests WHERE state IN ('sending', 'uncertain', 'rejected');
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToCountUnresolvedRequestsResult(res) : null;
}

function mapArrayToCountUnresolvedRequestsResult(data: any) {
  const result: CountUnresolvedRequestsResult = {
    unresolved: data[0],
  };
  return result;
}
