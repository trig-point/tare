SELECT COUNT(*) AS count FROM days
WHERE user_id = :user_id AND signed_off_at IS NOT NULL;
