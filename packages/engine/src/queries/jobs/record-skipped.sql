UPDATE job_runs SET last_skipped_at = :skippedAt, skipped_count = skipped_count + 1
WHERE job_name = :jobName
RETURNING job_name;
