import type { Database } from "better-sqlite3";

export type RecordStartParams = {
  jobName: string;
  startedAt: string;
};

export type RecordStartResult = {
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "failed";
  detail: string | null;
  last_skipped_at: string | null;
  skipped_count: number;
};

export function recordStart(
  db: Database,
  params: RecordStartParams,
): RecordStartResult | null {
  const sql = `
	INSERT INTO job_runs (job_name, started_at, finished_at, status, detail)
	VALUES (?, ?, NULL, 'running', NULL)
	ON CONFLICT (job_name) DO UPDATE SET
	  started_at = excluded.started_at,
	  finished_at = NULL,
	  status = 'running',
	  detail = NULL
	RETURNING *;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.jobName, params.startedAt]);

  return res ? mapArrayToRecordStartResult(res) : null;
}

function mapArrayToRecordStartResult(data: any) {
  const result: RecordStartResult = {
    job_name: data[0],
    started_at: data[1],
    finished_at: data[2],
    status: data[3],
    detail: data[4],
    last_skipped_at: data[5],
    skipped_count: data[6],
  };
  return result;
}
