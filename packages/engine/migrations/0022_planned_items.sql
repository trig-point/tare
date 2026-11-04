CREATE TABLE planned_items (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL CHECK (date(day, '+0 days') IS NOT NULL AND date(day, '+0 days') = day),
  template_id INTEGER,
  position INTEGER CHECK (position >= 0),
  order_meal_id INTEGER,
  food_id INTEGER,
  servings REAL,
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'eaten', 'skipped')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') IS updated_at),
  CHECK ((template_id IS NULL) = (position IS NULL)),
  CHECK ((order_meal_id IS NULL) <> (food_id IS NULL)),
  CHECK ((food_id IS NOT NULL AND servings IS NOT NULL AND servings > 0) OR (order_meal_id IS NOT NULL AND servings IS NULL)),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, order_meal_id) REFERENCES order_meals(user_id, id),
  FOREIGN KEY (user_id, food_id) REFERENCES foods(user_id, id)
) STRICT;

CREATE UNIQUE INDEX planned_items_open_slot ON planned_items (user_id, day, template_id, position)
WHERE template_id IS NOT NULL AND state = 'planned';
