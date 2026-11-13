INSERT INTO grocery_transactions (transaction_id, request_id, step_number) VALUES (:transaction_id, :request_id, :step_number)
ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id;
