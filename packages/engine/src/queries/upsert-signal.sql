INSERT INTO daily_signals (user_id, day, metric, value, source, updated_at)
VALUES (:user_id, :day, :metric, :value, :source, :updated_at)
ON CONFLICT (user_id, day, metric, source) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
RETURNING *;
