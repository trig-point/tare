-- tare:rebuild
-- One counter numbers network claims, local rejections and recovery records, so a recovered or retried request never resizes.
CREATE TABLE pantry_attempts_replacement (
  request_id TEXT NOT NULL REFERENCES pantry_requests(id),
  number INTEGER NOT NULL CHECK (number > 0),
  kind TEXT NOT NULL CHECK (kind IN ('network', 'local_rejection', 'recovery')),
  token TEXT UNIQUE,
  outcome TEXT NOT NULL CHECK (outcome IN ('sending', 'not_sent', 'confirmed', 'rejected', 'uncertain')),
  reason TEXT CHECK (reason IN ('disabled', 'not_owner', 'invalid_input', 'unauthorized', 'not_found', 'http', 'invalid_response', 'transport', 'timeout', 'too_large', 'response_withheld', 'product_missing', 'unit_mismatch', 'tare_enabled', 'restarted', 'restored_backup')),
  http_status INTEGER,
  receipt TEXT CHECK (receipt IS NULL OR json_valid(receipt)),
  started_at TEXT,
  finished_at TEXT,
  uncertain_since TEXT,
  recovered_from_number INTEGER CHECK (recovered_from_number IS NULL OR recovered_from_number > 0),
  PRIMARY KEY (request_id, number),
  CHECK ((outcome = 'confirmed') = (receipt IS NOT NULL)),
  CHECK ((kind = 'network') = (token IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (kind != 'local_rejection' OR outcome = 'rejected'),
  CHECK (kind != 'recovery' OR (outcome = 'uncertain' AND uncertain_since IS NOT NULL))
) STRICT;
INSERT INTO pantry_attempts_replacement (request_id, number, kind, token, outcome, reason, http_status, receipt, started_at, finished_at, uncertain_since)
SELECT request_id, number, 'network', token, outcome, reason, http_status, receipt, started_at, finished_at, CASE WHEN outcome = 'uncertain' THEN finished_at END FROM pantry_attempts;
DROP TABLE pantry_attempts;
ALTER TABLE pantry_attempts_replacement RENAME TO pantry_attempts;

-- Uncertain rows without uncertain_since get a recovery record at the next startup instead of a guessed time.
ALTER TABLE pantry_requests ADD COLUMN uncertain_since TEXT;
ALTER TABLE pantry_requests ADD COLUMN updated_at TEXT;
ALTER TABLE pantry_requests ADD COLUMN resolved_at TEXT;

CREATE TABLE pantry_decisions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  request_id TEXT NOT NULL REFERENCES pantry_requests(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 100),
  number INTEGER NOT NULL CHECK (number >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('attempt_resolution', 'pending_abandon')),
  decision TEXT NOT NULL CHECK (decision IN ('delivered', 'not_delivered_retry', 'abandoned')),
  resulting_state TEXT NOT NULL CHECK (resulting_state IN ('pending', 'delivered', 'abandoned')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  UNIQUE (user_id, mutation_id),
  CHECK (kind = 'attempt_resolution' OR decision = 'abandoned')
) STRICT;
CREATE UNIQUE INDEX pantry_decisions_subject ON pantry_decisions (request_id, number) WHERE kind = 'attempt_resolution';
CREATE INDEX pantry_decisions_request ON pantry_decisions (request_id, created_at);

DROP TRIGGER pantry_requests_intake_deleted;
CREATE TRIGGER pantry_requests_intake_deleted BEFORE DELETE ON intake_entries BEGIN
  UPDATE pantry_requests SET
    resolved_at = CASE state WHEN 'pending' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE resolved_at END,
    updated_at = CASE state WHEN 'pending' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END,
    state = CASE state WHEN 'pending' THEN 'cancelled' ELSE state END,
    intake_id = NULL,
    detached_intake = json_object('name', OLD.name, 'servings', OLD.servings, 'eaten_at', OLD.eaten_at, 'day', OLD.day, 'kcal', OLD.kcal, 'protein_g', OLD.protein_g, 'carbs_g', OLD.carbs_g, 'fat_g', OLD.fat_g, 'fiber_g', OLD.fiber_g)
  WHERE intake_id = OLD.id;
END;
