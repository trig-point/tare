INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, provenance, source, service, meal_name, chef, meal_key)
VALUES (:user_id, :name, :serving_size, :serving_unit, :kcal, :protein_g, :carbs_g, :fat_g, :fiber_g, :provenance, :source, :service, :meal_name, :chef, :meal_key)
RETURNING id;
