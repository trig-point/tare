INSERT INTO pantry_decisions (id, request_id, user_id, mutation_id, number, kind, decision, resulting_state, created_at)
VALUES (:id, :request_id, :user_id, :mutation_id, :number, :kind, :decision, :resulting_state, :created_at)
ON CONFLICT DO NOTHING RETURNING *;
