CREATE TABLE pantry_requests (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  user_id INTEGER NOT NULL REFERENCES users(id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  client_id TEXT NOT NULL,
  intake_id INTEGER UNIQUE,
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('food', 'source_food')),
  reference_id INTEGER NOT NULL CHECK (reference_id > 0),
  product_id INTEGER NOT NULL CHECK (product_id > 0),
  stock_unit_id INTEGER NOT NULL CHECK (stock_unit_id > 0),
  quantity_per_serving REAL NOT NULL CHECK (quantity_per_serving > 0 AND quantity_per_serving <= 1.7976931348623157e308),
  quantity REAL NOT NULL CHECK (quantity > 0 AND quantity <= 1.7976931348623157e308),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'uncertain', 'rejected', 'delivered', 'cancelled', 'abandoned')),
  reason TEXT CHECK (reason IN ('disabled', 'not_owner', 'invalid_input', 'unauthorized', 'not_found', 'http', 'invalid_response', 'transport', 'timeout', 'too_large', 'response_withheld', 'product_missing', 'unit_mismatch', 'tare_enabled', 'restarted', 'restored_backup')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token TEXT,
  edited_servings REAL CHECK (edited_servings IS NULL OR edited_servings > 0),
  detached_intake TEXT CHECK (detached_intake IS NULL OR json_valid(detached_intake)),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  -- Deleting an intake frees its client_id, so this lifetime key stops a replay from creating a second request.
  UNIQUE (user_id, client_id),
  FOREIGN KEY (user_id, intake_id) REFERENCES intake_entries (user_id, id),
  CHECK ((state = 'sending') = (claim_token IS NOT NULL))
) STRICT;
CREATE TABLE pantry_attempts (
  request_id TEXT NOT NULL REFERENCES pantry_requests(id),
  number INTEGER NOT NULL CHECK (number > 0),
  token TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL CHECK (outcome IN ('sending', 'not_sent', 'confirmed', 'rejected', 'uncertain')),
  reason TEXT CHECK (reason IN ('disabled', 'not_owner', 'invalid_input', 'unauthorized', 'not_found', 'http', 'invalid_response', 'transport', 'timeout', 'too_large', 'response_withheld', 'restarted', 'restored_backup')),
  http_status INTEGER,
  receipt TEXT CHECK (receipt IS NULL OR json_valid(receipt)),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (request_id, number),
  CHECK ((outcome = 'confirmed') = (receipt IS NOT NULL))
) STRICT;
CREATE TABLE pantry_outcomes (
  intake_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  generation INTEGER CHECK (generation IS NULL OR generation > 0),
  request_id TEXT REFERENCES pantry_requests(id),
  reason TEXT CHECK (reason IN ('disabled', 'not_owner', 'reset_required', 'no_binding', 'product_missing', 'unit_mismatch', 'tare_enabled')),
  FOREIGN KEY (user_id, intake_id) REFERENCES intake_entries (user_id, id) ON DELETE CASCADE,
  CHECK ((request_id IS NULL) != (reason IS NULL)),
  CHECK (generation IS NOT NULL OR reason = 'disabled')
) STRICT;
-- Only backup copies carry this row; startup on a restored copy treats unsent work as possibly sent.
CREATE TABLE pantry_backup_marker (id INTEGER PRIMARY KEY CHECK (id = 1)) STRICT;
-- The policy lives in triggers so no intake write path can skip it.
CREATE TRIGGER pantry_requests_intake_deleted BEFORE DELETE ON intake_entries BEGIN
  UPDATE pantry_requests SET
    state = CASE state WHEN 'pending' THEN 'cancelled' ELSE state END,
    intake_id = NULL,
    detached_intake = json_object('name', OLD.name, 'servings', OLD.servings, 'eaten_at', OLD.eaten_at, 'day', OLD.day, 'kcal', OLD.kcal, 'protein_g', OLD.protein_g, 'carbs_g', OLD.carbs_g, 'fat_g', OLD.fat_g, 'fiber_g', OLD.fiber_g)
  WHERE intake_id = OLD.id;
END;
CREATE TRIGGER pantry_requests_intake_servings AFTER UPDATE OF servings ON intake_entries WHEN OLD.servings IS NOT NEW.servings BEGIN
  UPDATE pantry_requests SET
    quantity = CASE WHEN state = 'pending' AND attempt_count = 0 THEN NEW.servings * quantity_per_serving ELSE quantity END,
    edited_servings = CASE WHEN state = 'pending' AND attempt_count = 0 THEN edited_servings ELSE NEW.servings END
  WHERE intake_id = NEW.id;
END;
