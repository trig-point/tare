SELECT id, old_kcal, old_protein_g, new_kcal, new_protein_g
FROM target_notices WHERE user_id = :user_id AND id > :after_id ORDER BY id;
