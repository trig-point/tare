UPDATE medication_doses
SET status = :status, taken_at = :taken_at, resolved_at = :resolved_at, skip_reason = :skip_reason, scheduled_at = :scheduled_at, water_ml = :water_ml
WHERE id = :id
RETURNING *
