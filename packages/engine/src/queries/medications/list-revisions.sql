SELECT * FROM medication_schedule_revisions WHERE medication_id = :medication_id
ORDER BY effective_from, id
