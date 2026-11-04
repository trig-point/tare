SELECT id, user_id FROM inbound_emails
WHERE parse_state = 'parsed' AND disposition IS NULL AND id > :after_id
ORDER BY id LIMIT 1;
