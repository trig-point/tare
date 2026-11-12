SELECT recipe_id, reference_kind, reference_id, servings, desired_servings_at_link FROM pantry_recipe_links WHERE user_id = :user_id AND generation = :generation ORDER BY recipe_id;
