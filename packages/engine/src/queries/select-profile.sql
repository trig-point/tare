SELECT user_id, height_cm, birth_date, sex, activity_level, goal_rate_kg_week, protein_factor, updated_at
FROM profiles
WHERE user_id = :user_id;
