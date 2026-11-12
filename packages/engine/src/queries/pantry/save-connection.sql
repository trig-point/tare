INSERT INTO pantry_connection (id, generation, url, username, user_id, reset_required, fetch_started_at, last_success_at, error)
VALUES (1, :generation, :url, :username, :user_id, :reset_required, :fetch_started_at, :last_success_at, :error)
ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, url = excluded.url, username = excluded.username, user_id = excluded.user_id, reset_required = excluded.reset_required, fetch_started_at = excluded.fetch_started_at, last_success_at = excluded.last_success_at, error = excluded.error;
