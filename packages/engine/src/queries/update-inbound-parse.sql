UPDATE inbound_emails
SET parse_state = :parse_state, parse_result = :parse_result, reason_class = :reason_class, updated_at = :now
WHERE id = :id AND user_id = :user_id AND parse_state = 'queued';
