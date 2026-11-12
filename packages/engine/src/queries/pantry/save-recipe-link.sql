INSERT INTO pantry_recipe_links (user_id, generation, recipe_id, reference_kind, reference_id, servings, desired_servings_at_link)
VALUES (:user_id, :generation, :recipe_id, :reference_kind, :reference_id, :servings, :desired_servings_at_link)
ON CONFLICT(user_id, generation, recipe_id) DO UPDATE SET reference_kind = excluded.reference_kind, reference_id = excluded.reference_id, servings = excluded.servings, desired_servings_at_link = excluded.desired_servings_at_link;
