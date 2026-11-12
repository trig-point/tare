import type { Database } from "better-sqlite3";

export type CancelPendingRequestsData = {
  resolved_at: string | null;
  updated_at: string | null;
};

export type CancelPendingRequestsResult = {
  changes: number;
};

export function cancelPendingRequests(
  db: Database,
  data: CancelPendingRequestsData,
): CancelPendingRequestsResult {
  const sql = `
	UPDATE pantry_requests SET state = 'cancelled', resolved_at = ?, updated_at = ? WHERE state = 'pending';
	
	`;
  return db
    .prepare(sql)
    .run([data.resolved_at, data.updated_at]) as CancelPendingRequestsResult;
}
