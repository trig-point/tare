INSERT INTO medication_doses
  (public_key, medication_id, revision_id, slot_date, slot_time, slot_at, scheduled_at)
VALUES (:public_key, :medication_id, :revision_id, :slot_date, :slot_time, :slot_at, :scheduled_at)
ON CONFLICT (medication_id, slot_date, slot_time) DO NOTHING
