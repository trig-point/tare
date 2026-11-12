INSERT INTO pantry_bindings (user_id, generation, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, status, change_token)
VALUES (:user_id, :generation, 'food', :reference_id, :product_id, :stock_unit_id, :quantity_per_serving, 'valid', :change_token)
ON CONFLICT DO NOTHING RETURNING change_token;
