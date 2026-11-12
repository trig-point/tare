SELECT product_id, stock_unit_id,
  sum(CASE WHEN state = 'pending' THEN quantity ELSE 0.0 END) AS pending,
  sum(CASE WHEN state = 'sending' THEN quantity ELSE 0.0 END) AS sending,
  sum(CASE WHEN state = 'uncertain' THEN quantity ELSE 0.0 END) AS uncertain
FROM pantry_requests WHERE user_id = :user_id AND generation = :generation AND state IN ('pending', 'sending', 'uncertain')
GROUP BY product_id, stock_unit_id ORDER BY product_id, stock_unit_id;
