UPDATE grocery_steps SET state = :state, reason = :reason, claim_token = NULL, object_id = :object_id, transaction_id = :transaction_id, updated_at = :now
WHERE claim_token = :claim_token AND state = 'sending'
RETURNING request_id, number;
