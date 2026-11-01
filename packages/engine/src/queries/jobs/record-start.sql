INSERT INTO job_runs (job_name, started_at, finished_at, status, detail)
VALUES (:jobName, :startedAt, NULL, 'running', NULL)
ON CONFLICT (job_name) DO UPDATE SET
  started_at = excluded.started_at,
  finished_at = NULL,
  status = 'running',
  detail = NULL
RETURNING *;
