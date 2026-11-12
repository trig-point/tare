INSERT INTO food_receipts (user_id, mutation_id, request_hash, food_id, created_at)
VALUES (:user_id, :mutation_id, :request_hash, :food_id, :created_at) RETURNING *;
