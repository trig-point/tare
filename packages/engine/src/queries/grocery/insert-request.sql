INSERT INTO grocery_requests (user_id, mutation_id, plan_hash, plan, generation, url, username, restore_nonce, food_id, food_fingerprint, state, created_at, updated_at)
VALUES (:user_id, :mutation_id, :plan_hash, :plan, :generation, :url, :username, :restore_nonce, :food_id, :food_fingerprint, 'open', :created_at, :created_at)
RETURNING *;
