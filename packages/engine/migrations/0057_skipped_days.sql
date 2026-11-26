ALTER TABLE days ADD COLUMN skipped_at TEXT CHECK (
  skipped_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', skipped_at, '+0 seconds') IS skipped_at
);
