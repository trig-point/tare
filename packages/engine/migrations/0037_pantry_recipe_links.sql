CREATE TABLE pantry_recipe_links (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  recipe_id INTEGER NOT NULL CHECK (recipe_id > 0),
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('food', 'source_food')),
  reference_id INTEGER NOT NULL CHECK (reference_id > 0),
  servings REAL NOT NULL CHECK (servings > 0),
  desired_servings_at_link REAL NOT NULL CHECK (desired_servings_at_link > 0),
  PRIMARY KEY (user_id, generation, recipe_id)
) STRICT;
