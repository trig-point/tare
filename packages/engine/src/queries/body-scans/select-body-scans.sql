SELECT id, day, method, total_mass_kg, body_fat_pct, fat_mass_kg, lean_mass_kg, bone_mineral_kg, arms_fat_pct, arms_lean_kg, legs_fat_pct, legs_lean_kg, trunk_fat_pct, trunk_lean_kg, android_fat_pct, android_lean_kg, gynoid_fat_pct, gynoid_lean_kg, bone_density_g_cm2, t_score, note
FROM body_scans
WHERE user_id = :user_id
ORDER BY day, id;
