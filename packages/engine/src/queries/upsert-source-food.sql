INSERT INTO source_foods (source, source_key, name, brand, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, provenance, fetched_at, barcode)
VALUES (:source, :source_key, :name, :brand, :serving_size, :serving_unit, :kcal, :protein_g, :carbs_g, :fat_g, :fiber_g, :provenance, :fetched_at, :barcode)
ON CONFLICT (source, source_key) DO UPDATE SET
  name = excluded.name, brand = excluded.brand,
  serving_size = excluded.serving_size, serving_unit = excluded.serving_unit,
  kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
  fat_g = excluded.fat_g, fiber_g = excluded.fiber_g,
  provenance = excluded.provenance, fetched_at = excluded.fetched_at,
  barcode = COALESCE(:barcode, source_foods.barcode)
RETURNING *;
