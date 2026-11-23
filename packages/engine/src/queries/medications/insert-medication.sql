INSERT INTO medications (name, active, late_after_minutes, active_since, generated_until)
VALUES (:name, :active, :late_after_minutes, :active_since, :generated_until)
RETURNING *
