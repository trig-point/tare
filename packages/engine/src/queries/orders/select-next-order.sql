SELECT * FROM orders WHERE user_id = :user_id AND service = :service
AND delivery_date > :received_on ORDER BY delivery_date, id LIMIT 1;
