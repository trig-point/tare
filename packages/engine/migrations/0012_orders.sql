CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  service TEXT NOT NULL CHECK (length(trim(service)) > 0),
  delivery_date TEXT NOT NULL CHECK (date(delivery_date, '+0 days') IS delivery_date),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'processed')),
  delivered_at TEXT CHECK (delivered_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', delivered_at, '+0 seconds') IS delivered_at),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  UNIQUE (user_id, service, delivery_date),
  UNIQUE (user_id, id)
) STRICT;

CREATE TABLE order_meals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  chef TEXT,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  FOREIGN KEY (user_id, order_id) REFERENCES orders (user_id, id),
  UNIQUE (user_id, id)
) STRICT;
CREATE INDEX order_meals_user_order ON order_meals (user_id, order_id);
