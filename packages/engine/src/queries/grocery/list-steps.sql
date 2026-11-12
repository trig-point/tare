SELECT number, kind, state, reason, product_id, stock_log_max, object_id, transaction_id, updated_at FROM grocery_steps WHERE request_id = :request_id ORDER BY number;
