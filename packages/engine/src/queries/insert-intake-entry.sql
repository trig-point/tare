INSERT INTO intake_entries (slot_template_id, slot_position, user_id, client_id, food_id, source_food_id, servings, eaten_at, day, kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance, source, portion_note, created_at, updated_at, name, amount_estimated, servings_low, servings_high)
VALUES (:slot_template_id, :slot_position, :user_id, :client_id, :food_id, :source_food_id, :servings, :eaten_at, :day, :kcal, :protein_g, :carbs_g, :fat_g, :fiber_g, :kcal_low, :kcal_high, :provenance, :source, :portion_note, :created_at, :updated_at, :name, :amount_estimated, :servings_low, :servings_high) ON CONFLICT (user_id, client_id) DO NOTHING RETURNING user_id, id, client_id, food_id, source_food_id, servings, eaten_at, day,
  kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance,
  source, portion_note, created_at, updated_at, name, slot_template_id,
  slot_position, amount_estimated, servings_low, servings_high;
