-- Owner decisions on grocery requests, replayed by UUID and never edited.
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
CREATE TRIGGER grocery_decisions_frozen BEFORE UPDATE ON grocery_decisions BEGIN
  SELECT RAISE(ABORT, 'grocery decision is immutable');
END;
CREATE TRIGGER grocery_decisions_kept BEFORE DELETE ON grocery_decisions BEGIN
  SELECT RAISE(ABORT, 'grocery decisions are kept');
END;
