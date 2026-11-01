INSERT INTO source_foods (source, source_key, name, brand, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, provenance, fetched_at)
VALUES (:source, :source_key, :name, :brand, :serving_size, :serving_unit, :kcal, :protein_g, :carbs_g, :fat_g, :fiber_g, :provenance, :fetched_at) RETURNING *;
