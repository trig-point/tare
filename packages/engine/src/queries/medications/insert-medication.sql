INSERT INTO medications (name, active, late_after_minutes, generated_until)
VALUES (:name, :active, :late_after_minutes, :generated_until)
RETURNING *
