SELECT event.id, event.kind, event.dose_status, intake.name AS food_name, intake.kcal, intake.protein_g,
  slot.name AS slot, weight.weight_kg, session.kind AS workout_kind, session.duration_minutes,
  medication.name AS medication
FROM activity_events event
LEFT JOIN intake_entries intake ON event.kind = 'food' AND intake.id = event.record_id
LEFT JOIN template_slots slot ON slot.user_id = intake.user_id
  AND slot.template_id = intake.slot_template_id AND slot.position = intake.slot_position
LEFT JOIN weights weight ON event.kind = 'weight' AND weight.id = event.record_id
LEFT JOIN activity_sessions session ON event.kind = 'workout' AND session.id = event.record_id
LEFT JOIN medication_doses dose ON event.kind = 'dose' AND dose.id = event.record_id
LEFT JOIN medications medication ON medication.id = dose.medication_id
WHERE (event.user_id = :user_id OR event.user_id IS NULL) AND event.id > :after_id ORDER BY event.id;
