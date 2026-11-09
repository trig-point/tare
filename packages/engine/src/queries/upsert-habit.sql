INSERT INTO habit_log (user_id, day, habit_key, amount, note, source, updated_at)
VALUES (:user_id, :day, :habit_key, :amount, :note, :source, :updated_at)
ON CONFLICT (user_id, day, habit_key) DO UPDATE SET
  amount = excluded.amount, note = excluded.note, source = excluded.source, updated_at = excluded.updated_at
RETURNING *;
