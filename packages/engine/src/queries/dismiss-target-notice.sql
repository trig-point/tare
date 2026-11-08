UPDATE target_notices SET dismissed_at = COALESCE(dismissed_at, :dismissed_at)
WHERE id = :id AND user_id = :user_id
RETURNING id;
