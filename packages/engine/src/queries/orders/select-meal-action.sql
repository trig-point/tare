SELECT * FROM meal_actions
WHERE user_id = :user_id AND mutation_id = :mutation_id LIMIT 1;
