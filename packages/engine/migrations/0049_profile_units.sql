ALTER TABLE users ADD COLUMN body_units TEXT NOT NULL DEFAULT 'metric'
  CHECK (body_units IN ('metric', 'imperial'));
