CREATE TABLE job_runs (
  job_name TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  detail TEXT,
  last_skipped_at TEXT,
  skipped_count INTEGER NOT NULL DEFAULT 0
) STRICT;
