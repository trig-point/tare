UPDATE inbound_emails SET parse_state = 'queued', released_at = :now, updated_at = :now
WHERE user_id = :user_id AND id = :id AND parse_state = 'held' AND disposition IS NULL;
