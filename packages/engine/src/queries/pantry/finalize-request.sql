UPDATE pantry_requests SET state = :state, reason = :reason, claim_token = NULL WHERE id = :id AND state = 'sending' AND claim_token = :claim_token RETURNING id;
