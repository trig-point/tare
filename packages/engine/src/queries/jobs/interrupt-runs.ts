import type { Database } from "better-sqlite3";

export type InterruptRunsResult = {
  changes: number;
};

export function interruptRuns(db: Database): InterruptRunsResult {
  const sql = `
	UPDATE job_runs SET status = 'failed', detail = 'interrupted'
	WHERE status = 'running';
	
	`;
  return db.prepare(sql).run() as InterruptRunsResult;
}
