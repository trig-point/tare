UPDATE pantry_requests SET state = :state, reason = :reason, claim_token = NULL, updated_at = :now,
  uncertain_since = CASE WHEN :state = 'uncertain' THEN :now END,
  resolved_at = CASE WHEN :state = 'delivered' THEN :now END
WHERE id = :id AND state = 'sending' AND claim_token = :claim_token RETURNING id;
