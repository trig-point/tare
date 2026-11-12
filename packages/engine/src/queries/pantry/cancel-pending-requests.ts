import type { Database } from "better-sqlite3";

export type CancelPendingRequestsResult = {
  changes: number;
};

export function cancelPendingRequests(
  db: Database,
): CancelPendingRequestsResult {
  const sql = `
	UPDATE pantry_requests SET state = 'cancelled' WHERE state = 'pending';
	
	`;
  return db.prepare(sql).run() as CancelPendingRequestsResult;
}
