INSERT INTO medications (name, active, late_after_minutes, water_ml, generated_until)
VALUES (:name, :active, :late_after_minutes, :water_ml, :generated_until)
RETURNING *
