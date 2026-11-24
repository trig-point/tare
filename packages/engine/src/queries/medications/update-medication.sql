UPDATE medications
SET name = :name, active = :active, late_after_minutes = :late_after_minutes,
    water_ml = :water_ml, generated_until = :generated_until
WHERE id = :id
