INSERT INTO profiles (user_id, height_cm, birth_date, sex, activity_level, goal_rate_kg_week, protein_factor, updated_at)
VALUES (:user_id, :height_cm, :birth_date, :sex, :activity_level, :goal_rate_kg_week, :protein_factor, :updated_at)
ON CONFLICT (user_id) DO UPDATE SET
  height_cm = excluded.height_cm,
  birth_date = excluded.birth_date,
  sex = excluded.sex,
  activity_level = excluded.activity_level,
  goal_rate_kg_week = excluded.goal_rate_kg_week,
  protein_factor = excluded.protein_factor,
  updated_at = excluded.updated_at
RETURNING user_id, height_cm, birth_date, sex, activity_level, goal_rate_kg_week, protein_factor, updated_at;
