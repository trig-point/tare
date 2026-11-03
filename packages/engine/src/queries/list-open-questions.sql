SELECT id, kind, subject_ref, prompt, answer_schema, created_at
FROM questions
WHERE (user_id = :actor_id OR (user_id IS NULL AND :actor_is_admin_browser = 1))
  AND status = 'open'
ORDER BY id;
