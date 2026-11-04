SELECT inbound_emails.*, users.timezone, users.day_start_hour
FROM inbound_emails JOIN users ON users.id = inbound_emails.user_id
WHERE parse_state = 'queued' AND inbound_emails.id > :after_id
ORDER BY inbound_emails.id LIMIT 1;
