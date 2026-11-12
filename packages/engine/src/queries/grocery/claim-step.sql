UPDATE grocery_steps SET state = 'sending', claim_token = :claim_token, product_id = :product_id, stock_log_max = :stock_log_max, updated_at = :now
WHERE request_id = :request_id AND number = :number AND state = 'pending'
  AND EXISTS (SELECT 1 FROM grocery_requests WHERE id = :request_id AND state = 'open')
  AND NOT EXISTS (SELECT 1 FROM grocery_steps AS earlier WHERE earlier.request_id = :request_id AND earlier.number < :number AND earlier.state NOT IN ('confirmed', 'adopted'))
RETURNING request_id, number, kind, claim_token;
