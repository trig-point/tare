ALTER TABLE profiles ADD COLUMN units TEXT NOT NULL DEFAULT 'metric'
  CHECK (units IN ('metric', 'imperial'));
