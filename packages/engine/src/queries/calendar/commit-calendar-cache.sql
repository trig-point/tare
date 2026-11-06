INSERT INTO calendar_cache (user_id, day, timezone, day_start_hour, revision, status, day_type_id, fetched_at)
VALUES (:user_id, :day, :timezone, :day_start_hour, :revision, :status, :day_type_id, :fetched_at)
ON CONFLICT (user_id, day, timezone, day_start_hour, revision)
DO UPDATE SET status = excluded.status, day_type_id = excluded.day_type_id, fetched_at = excluded.fetched_at;
