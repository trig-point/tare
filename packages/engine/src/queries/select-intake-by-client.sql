SELECT user_id, id, client_id, food_id, source_food_id, servings, eaten_at, day,
  kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance,
  source, portion_note, created_at, updated_at, name, slot_template_id,
  slot_position, amount_estimated, servings_low, servings_high FROM intake_entries WHERE user_id = :user_id AND client_id = :client_id LIMIT 1;
