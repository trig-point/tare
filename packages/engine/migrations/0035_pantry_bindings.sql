CREATE TABLE pantry_bindings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('food', 'source_food')),
  reference_id INTEGER NOT NULL CHECK (reference_id > 0),
  product_id INTEGER NOT NULL CHECK (product_id > 0),
  stock_unit_id INTEGER NOT NULL CHECK (stock_unit_id > 0),
  quantity_per_serving REAL NOT NULL CHECK (quantity_per_serving > 0),
  status TEXT NOT NULL CHECK (status IN ('valid', 'product_missing', 'unit_mismatch', 'tare_enabled')),
  change_token TEXT NOT NULL,
  PRIMARY KEY (user_id, generation, reference_kind, reference_id)
) STRICT;
