INSERT INTO calendar_settings (user_id, feed_url, enabled, revision, created_at, updated_at)
VALUES (:user_id, :feed_url, :enabled, 1, :now, :now)
ON CONFLICT (user_id) DO UPDATE SET feed_url = excluded.feed_url, enabled = excluded.enabled,
revision = calendar_settings.revision + 1, updated_at = excluded.updated_at;
