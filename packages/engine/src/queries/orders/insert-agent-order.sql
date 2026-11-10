INSERT INTO inbound_emails (user_id, service, mark, dedupe_key, raw, subject_attached, parse_state, manual_result, origin, created_at, updated_at)
VALUES (:user_id, :service, 'verified', :dedupe_key, :raw, 0, 'no_model', :manual_result, 'agent', :now, :now)
ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id;
