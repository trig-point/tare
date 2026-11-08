SELECT id, created_at, old_kcal, old_protein_g, new_kcal, new_protein_g
FROM target_notices
WHERE user_id = :user_id AND dismissed_at IS NULL
  AND id = (SELECT MAX(id) FROM target_notices WHERE user_id = :user_id);
