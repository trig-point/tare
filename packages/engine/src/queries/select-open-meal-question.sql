SELECT id FROM questions
WHERE user_id = :user_id AND kind = 'meal_nutrition'
  AND subject_ref = :meal_key AND status = 'open'
LIMIT 1;
