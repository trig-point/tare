UPDATE foods SET name = :name, serving_size = :serving_size, serving_unit = :serving_unit,
  kcal = :kcal, protein_g = :protein_g, carbs_g = :carbs_g, fat_g = :fat_g, fiber_g = :fiber_g,
  kcal_low = :kcal_low, kcal_high = :kcal_high, provenance = :provenance, source = :source
WHERE user_id = :user_id AND id = :id RETURNING id;
