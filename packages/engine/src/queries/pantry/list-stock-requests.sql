SELECT pantry_requests.product_id, pantry_requests.stock_unit_id, pantry_requests.quantity, pantry_requests.state,
  (SELECT started_at FROM pantry_attempts WHERE request_id = pantry_requests.id AND number = pantry_requests.attempt_count AND outcome = 'sending') AS sent_at,
  (SELECT finished_at FROM pantry_attempts WHERE request_id = pantry_requests.id AND outcome = 'confirmed') AS confirmed_at
FROM pantry_requests
WHERE pantry_requests.user_id = :user_id AND pantry_requests.generation = :generation
  AND (pantry_requests.state IN ('pending', 'sending', 'uncertain', 'rejected')
    OR (pantry_requests.state = 'delivered' AND NOT EXISTS (
      SELECT 1 FROM pantry_attempts WHERE request_id = pantry_requests.id AND outcome = 'confirmed'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', finished_at, '+0 seconds') IS finished_at AND finished_at < :fetch_started_at)))
ORDER BY pantry_requests.product_id, pantry_requests.id;
