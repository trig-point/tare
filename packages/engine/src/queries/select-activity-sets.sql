SELECT activity_sets.session_id, activity_sets.set_index, activity_sets.exercise, activity_sets.set_type, activity_sets.reps,
  activity_sets.load_kg, activity_sets.load_unit, activity_sets.duration_seconds, activity_sets.rir_low, activity_sets.rir_high, activity_sets.notes
FROM activity_sets JOIN activity_sessions
  ON activity_sessions.user_id = activity_sets.user_id AND activity_sessions.id = activity_sets.session_id
WHERE activity_sets.user_id = :user_id AND activity_sessions.day BETWEEN :from AND :to
ORDER BY activity_sets.session_id, activity_sets.set_index;
