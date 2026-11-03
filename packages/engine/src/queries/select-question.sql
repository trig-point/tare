SELECT * FROM questions
WHERE (user_id = :actor_id OR (user_id IS NULL AND :actor_is_admin_browser = 1))
  AND id = :id LIMIT 1;
