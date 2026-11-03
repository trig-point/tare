SELECT id, user_id, name, template_id FROM day_types
WHERE user_id = :user_id AND id = COALESCE(
  (SELECT day_type_id FROM day_type_choices WHERE user_id = :user_id AND day = :day),
  (SELECT day_type_id FROM default_day_types WHERE user_id = :user_id)
);
