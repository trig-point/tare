CREATE TABLE pantry_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL,
  url TEXT NOT NULL,
  username TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  reset_required INTEGER NOT NULL DEFAULT 0,
  fetch_started_at TEXT,
  last_success_at TEXT,
  error TEXT
);
CREATE TABLE pantry_products (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product TEXT NOT NULL,
  PRIMARY KEY (user_id, generation, product_id)
);
