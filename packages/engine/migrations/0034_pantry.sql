CREATE TABLE pantry_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL CHECK (generation > 0),
  url TEXT NOT NULL,
  username TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  reset_required INTEGER NOT NULL DEFAULT 0 CHECK (reset_required IN (0, 1)),
  fetch_started_at TEXT CHECK (fetch_started_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', fetch_started_at, '+0 seconds') IS fetch_started_at),
  last_success_at TEXT CHECK (last_success_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', last_success_at, '+0 seconds') IS last_success_at),
  error TEXT
) STRICT;
CREATE TABLE pantry_products (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  product_id INTEGER NOT NULL,
  product TEXT NOT NULL,
  PRIMARY KEY (user_id, generation, product_id)
) STRICT;
