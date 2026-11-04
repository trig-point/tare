SELECT id, user_id FROM inbound_emails
WHERE parse_state IN ('parsed', 'no_model', 'failed') AND disposition IS NULL AND id > :after_id
ORDER BY id LIMIT 1;
