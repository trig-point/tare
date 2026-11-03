SELECT intake_entries.day, kcal, kcal_low, kcal_high, provenance
FROM days
JOIN intake_entries ON intake_entries.user_id = days.user_id AND intake_entries.day = days.day
WHERE days.user_id = :user_id AND days.day >= :start AND days.day <= :end
  AND days.signed_off_at IS NOT NULL
ORDER BY intake_entries.day, intake_entries.id;
