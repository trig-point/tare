UPDATE medications
SET name = :name, active = :active, late_after_minutes = :late_after_minutes,
    active_since = :active_since, generated_until = :generated_until
WHERE id = :id
