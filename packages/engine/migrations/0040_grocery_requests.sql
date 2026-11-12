-- A confirmed grocery plan, frozen at creation; its numbered steps each send at most one Grocy write.
CREATE TABLE grocery_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) = 36),
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  plan TEXT NOT NULL CHECK (json_valid(plan)),
  generation INTEGER NOT NULL CHECK (generation > 0),
  url TEXT NOT NULL,
  username TEXT NOT NULL,
  restore_nonce TEXT NOT NULL,
  food_id INTEGER NOT NULL,
  food_fingerprint TEXT NOT NULL CHECK (length(food_fingerprint) = 64),
  state TEXT NOT NULL CHECK (state IN ('open', 'binding_pending', 'completed', 'abandoned')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, mutation_id),
  FOREIGN KEY (user_id, food_id) REFERENCES foods (user_id, id)
) STRICT;
CREATE TABLE grocery_steps (
  request_id INTEGER NOT NULL REFERENCES grocery_requests(id),
  number INTEGER NOT NULL CHECK (number > 0),
  kind TEXT NOT NULL CHECK (kind IN ('unit', 'location', 'product', 'barcode', 'stock_add')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'confirmed', 'rejected', 'uncertain', 'adopted', 'abandoned')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 40),
  claim_token TEXT UNIQUE,
  product_id INTEGER CHECK (product_id IS NULL OR product_id > 0),
  stock_log_max INTEGER CHECK (stock_log_max IS NULL OR stock_log_max >= 0),
  object_id INTEGER CHECK (object_id IS NULL OR object_id > 0),
  transaction_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (request_id, number),
  CHECK ((state = 'sending') = (claim_token IS NOT NULL)),
  -- Discovery after a lost add response only trusts stock_log rows above the maximum proved before sending.
  CHECK (kind != 'stock_add' OR state NOT IN ('sending', 'confirmed') OR (product_id IS NOT NULL AND stock_log_max IS NOT NULL)),
  CHECK (state NOT IN ('confirmed', 'adopted') OR CASE kind WHEN 'stock_add' THEN transaction_id IS NOT NULL ELSE object_id IS NOT NULL END)
) STRICT;
-- Never cleared by reset: one Grocy purchase credits one request across every owner and generation.
CREATE TABLE grocery_transactions (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  request_id INTEGER NOT NULL REFERENCES grocery_requests(id),
  step_number INTEGER NOT NULL
) STRICT;
CREATE TABLE grocery_decisions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) = 36),
  decision_hash TEXT NOT NULL CHECK (length(decision_hash) = 64),
  request_id INTEGER NOT NULL REFERENCES grocery_requests(id),
  step_number INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('adopt', 'abandon', 'bind')),
  resulting_state TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  PRIMARY KEY (user_id, mutation_id)
) STRICT;
-- Rotated when startup consumes a backup marker, so proposals made before a restore cannot start or adopt.
CREATE TABLE grocery_restore_nonce (id INTEGER PRIMARY KEY CHECK (id = 1), nonce TEXT NOT NULL) STRICT;
INSERT INTO grocery_restore_nonce (id, nonce) VALUES (1, lower(hex(randomblob(16))));

CREATE TRIGGER grocery_requests_frozen BEFORE UPDATE OF id, user_id, mutation_id, plan_hash, plan, generation, url, username, restore_nonce, food_id, food_fingerprint, created_at ON grocery_requests BEGIN
  SELECT RAISE(ABORT, 'grocery plan is immutable');
END;
CREATE TRIGGER grocery_requests_final BEFORE UPDATE OF state ON grocery_requests WHEN OLD.state IN ('completed', 'abandoned') BEGIN
  SELECT RAISE(ABORT, 'grocery request is final');
END;
CREATE TRIGGER grocery_requests_kept BEFORE DELETE ON grocery_requests BEGIN
  SELECT RAISE(ABORT, 'grocery requests are kept');
END;
CREATE TRIGGER grocery_decisions_frozen BEFORE UPDATE ON grocery_decisions BEGIN
  SELECT RAISE(ABORT, 'grocery decision is immutable');
END;
CREATE TRIGGER grocery_decisions_kept BEFORE DELETE ON grocery_decisions BEGIN
  SELECT RAISE(ABORT, 'grocery decisions are kept');
END;
