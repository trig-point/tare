INSERT INTO orders (user_id, service, delivery_date, status, created_at)
VALUES (:user_id, :service, :delivery_date, :status, :created_at) RETURNING *;
