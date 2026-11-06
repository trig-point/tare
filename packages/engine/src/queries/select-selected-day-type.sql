SELECT id, user_id, name, template_id FROM day_types
WHERE user_id = :user_id AND id = COALESCE(
  (SELECT day_type_id FROM day_type_choices WHERE user_id = :user_id AND day = :day),
  (SELECT cache.day_type_id FROM calendar_cache cache
   JOIN calendar_settings settings ON settings.user_id = cache.user_id AND settings.revision = cache.revision
   WHERE cache.user_id = :user_id AND cache.day = :day AND cache.timezone = :timezone
   AND cache.day_start_hour = :day_start_hour AND settings.enabled = 1 AND cache.status = 'match'
   AND cache.fetched_at > :fresh_after AND cache.fetched_at <= :now),
  (SELECT day_type_id FROM default_day_types WHERE user_id = :user_id)
);
