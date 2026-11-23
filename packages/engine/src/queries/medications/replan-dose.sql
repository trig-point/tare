UPDATE medication_doses
SET revision_id = :revision_id, slot_at = :slot_at, scheduled_at = :scheduled_at
WHERE id = :id AND status = 'scheduled'
