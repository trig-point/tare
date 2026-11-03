SELECT user_id, template_id, position, name, start_minute, end_minute, share_bp, fill_hint
FROM template_slots WHERE user_id = :user_id AND template_id = :template_id
ORDER BY position;
