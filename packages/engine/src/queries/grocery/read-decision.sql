SELECT decision_hash, request_id, step_number, decision, resulting_state FROM grocery_decisions WHERE user_id = :user_id AND mutation_id = :mutation_id;
