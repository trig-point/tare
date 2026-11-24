INSERT INTO medication_schedule_revisions
  (medication_id, effective_from, effective_to, timezone, days, times)
VALUES (:medication_id, :effective_from, :effective_to, :timezone, :days, :times)
RETURNING *
