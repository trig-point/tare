import type { Database } from "better-sqlite3";

export type RecordFinishData = {
  finishedAt: string | null;
  status: string;
  detail: string | null;
};

export type RecordFinishParams = {
  jobName: string;
};

export type RecordFinishResult = {
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  detail: string | null;
  last_skipped_at: string | null;
  skipped_count: number;
};

export function recordFinish(
  db: Database,
  data: RecordFinishData,
  params: RecordFinishParams,
): RecordFinishResult | null {
  const sql = `
	UPDATE job_runs SET finished_at = ?, status = ?, detail = ?
	WHERE job_name = ?
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([data.finishedAt, data.status, data.detail, params.jobName]);

  return res ? mapArrayToRecordFinishResult(res) : null;
}

function mapArrayToRecordFinishResult(data: any) {
  const result: RecordFinishResult = {
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
