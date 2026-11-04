SELECT * FROM orders WHERE user_id = :user_id AND service = :service
AND delivery_date = :delivery_date LIMIT 1;
