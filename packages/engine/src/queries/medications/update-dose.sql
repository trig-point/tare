UPDATE medication_doses
SET status = :status, taken_at = :taken_at, skip_reason = :skip_reason, scheduled_at = :scheduled_at
WHERE id = :id
RETURNING *
