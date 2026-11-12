UPDATE pantry_bindings SET product_id = :product_id, stock_unit_id = :stock_unit_id, quantity_per_serving = :quantity_per_serving, status = 'valid', change_token = :change_token
WHERE user_id = :user_id AND generation = :generation AND reference_kind = 'food' AND reference_id = :reference_id AND change_token = :expected_token AND status = :expected_status
RETURNING change_token;
