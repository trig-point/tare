INSERT INTO inbound_emails (user_id, service, mark, dedupe_key, raw, subject_attached, parse_state, reason_class, created_at, updated_at)
VALUES (:user_id, :service, :mark, :dedupe_key, :raw, :subject_attached, :parse_state, :reason_class, :now, :now)
ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id;
