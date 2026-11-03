UPDATE questions SET status = 'answered', answer = :answer, answered_at = :answered_at
WHERE (user_id = :actor_id OR (user_id IS NULL AND :actor_is_admin_browser = 1))
  AND id = :id AND status = 'open'
RETURNING id;
