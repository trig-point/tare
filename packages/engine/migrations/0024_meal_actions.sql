-- tare:rebuild
CREATE TABLE meal_actions_replacement (
  user_id INTEGER NOT NULL,
  mutation_id TEXT NOT NULL CHECK (length(trim(mutation_id)) BETWEEN 1 AND 100),
  order_meal_id INTEGER,
  planned_item_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('ate', 'ate_three_quarters', 'skip')),
  intake_entry_id INTEGER,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  PRIMARY KEY (user_id, mutation_id),
  CHECK (
    (action IN ('ate', 'ate_three_quarters') AND intake_entry_id IS NOT NULL
      AND (order_meal_id IS NOT NULL OR planned_item_id IS NOT NULL))
    OR (action = 'skip' AND planned_item_id IS NOT NULL
      AND order_meal_id IS NULL AND intake_entry_id IS NULL)
  ),
  FOREIGN KEY (user_id, order_meal_id) REFERENCES order_meals (user_id, id),
  FOREIGN KEY (user_id, planned_item_id) REFERENCES planned_items (user_id, id)
) STRICT;

INSERT INTO meal_actions_replacement
  (user_id, mutation_id, order_meal_id, action, intake_entry_id, result, created_at)
SELECT user_id, mutation_id, order_meal_id, action, intake_entry_id, result, created_at
FROM meal_actions;
DROP TABLE meal_actions;
ALTER TABLE meal_actions_replacement RENAME TO meal_actions;
