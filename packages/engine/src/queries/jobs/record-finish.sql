UPDATE job_runs SET finished_at = :finishedAt, status = :status, detail = :detail
WHERE job_name = :jobName
RETURNING *;
