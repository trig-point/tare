SELECT id, name, setup, cues, mistakes, safety, pictures, rest_seconds, source, equipment,
  (SELECT count(DISTINCT activity_sets.session_id) FROM activity_sets WHERE activity_sets.user_id = movements.user_id AND lower(activity_sets.exercise) = lower(movements.name)) AS sessions
FROM movements
WHERE user_id = :user_id
ORDER BY lower(name), id;
