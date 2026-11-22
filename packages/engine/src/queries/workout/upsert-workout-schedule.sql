INSERT INTO workout_schedules (user_id, document, updated_at)
VALUES (:user_id, :document, :updated_at)
ON CONFLICT (user_id) DO UPDATE SET
  document = excluded.document,
  updated_at = excluded.updated_at
RETURNING user_id, document, updated_at;
