SELECT id, computed_at, trigger, kcal, protein_g, basis, tdee_kcal, low_kcal, high_kcal
FROM target_results WHERE user_id = :user_id
ORDER BY computed_at DESC, id DESC LIMIT 1;
