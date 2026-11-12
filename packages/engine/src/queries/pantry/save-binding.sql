INSERT INTO pantry_bindings (user_id, generation, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, status, change_token)
VALUES (:user_id, :generation, :reference_kind, :reference_id, :product_id, :stock_unit_id, :quantity_per_serving, 'valid', :change_token)
ON CONFLICT(user_id, generation, reference_kind, reference_id) DO UPDATE SET stock_unit_id = excluded.stock_unit_id, quantity_per_serving = excluded.quantity_per_serving, status = 'valid', change_token = excluded.change_token WHERE product_id = excluded.product_id;
