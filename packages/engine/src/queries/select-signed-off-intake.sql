SELECT intake_entries.day, intake_entries.eaten_at, intake_entries.slot_template_id,
  intake_entries.slot_position, intake_entries.kcal
FROM intake_entries
JOIN days ON days.user_id = intake_entries.user_id AND days.day = intake_entries.day
WHERE intake_entries.user_id = :user_id AND days.signed_off_at IS NOT NULL;
