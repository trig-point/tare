INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance, source, source_food_id)
VALUES (:user_id, :name, :serving_size, :serving_unit, :kcal, :protein_g, :carbs_g, :fat_g, :fiber_g, :kcal_low, :kcal_high, :provenance, :source, :source_food_id) RETURNING *;
