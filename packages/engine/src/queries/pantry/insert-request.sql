INSERT INTO pantry_requests (id, user_id, generation, client_id, intake_id, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, quantity, state, created_at)
VALUES (:id, :user_id, :generation, :client_id, :intake_id, :reference_kind, :reference_id, :product_id, :stock_unit_id, :quantity_per_serving, :quantity, 'pending', :created_at);
