UPDATE job_runs SET status = 'failed', detail = 'interrupted'
WHERE status = 'running';
