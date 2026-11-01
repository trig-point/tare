import type { Database } from "better-sqlite3";

export type RecordSkippedData = {
  skippedAt: string | null;
};

export type RecordSkippedParams = {
  jobName: string;
};

export type RecordSkippedResult = {
  job_name: string;
};

export function recordSkipped(
  db: Database,
  data: RecordSkippedData,
  params: RecordSkippedParams,
): RecordSkippedResult | null {
  const sql = `
	UPDATE job_runs SET last_skipped_at = ?, skipped_count = skipped_count + 1
	WHERE job_name = ?
	RETURNING job_name;
	
	`;
  const res = db.prepare(sql).raw(true).get([data.skippedAt, params.jobName]);

  return res ? mapArrayToRecordSkippedResult(res) : null;
}

function mapArrayToRecordSkippedResult(data: any) {
  const result: RecordSkippedResult = {
    job_name: data[0],
  };
  return result;
}
