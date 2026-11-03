CREATE TABLE meal_actions (
  user_id INTEGER NOT NULL,
  mutation_id TEXT NOT NULL CHECK (length(trim(mutation_id)) BETWEEN 1 AND 100),
  order_meal_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ate', 'ate_three_quarters')),
  intake_entry_id INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  PRIMARY KEY (user_id, mutation_id),
  FOREIGN KEY (user_id, order_meal_id) REFERENCES order_meals (user_id, id)
) STRICT;
