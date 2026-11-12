SELECT id, user_id, mutation_id, generation, state, created_at FROM grocery_requests WHERE state IN ('open', 'binding_pending') ORDER BY id LIMIT :limit;
