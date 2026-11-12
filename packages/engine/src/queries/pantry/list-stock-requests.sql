SELECT product_id, stock_unit_id, quantity, state, sent_at, confirmed_at FROM (
  SELECT pantry_requests.id, pantry_requests.product_id, pantry_requests.stock_unit_id, pantry_requests.quantity, pantry_requests.state,
    (SELECT started_at FROM pantry_attempts WHERE request_id = pantry_requests.id AND number = pantry_requests.attempt_count AND outcome = 'sending') AS sent_at,
    -- A manual delivery has no confirmed attempt, so its decision time stands in.
    coalesce((SELECT finished_at FROM pantry_attempts WHERE request_id = pantry_requests.id AND outcome = 'confirmed'), pantry_requests.resolved_at) AS confirmed_at
  FROM pantry_requests
  WHERE pantry_requests.user_id = :user_id AND pantry_requests.generation = :generation
    AND pantry_requests.state IN ('pending', 'sending', 'uncertain', 'rejected', 'delivered')
)
WHERE state != 'delivered' OR confirmed_at IS NULL
  OR strftime('%Y-%m-%dT%H:%M:%fZ', confirmed_at, '+0 seconds') IS NOT confirmed_at OR confirmed_at >= :fetch_started_at
ORDER BY product_id, id;
