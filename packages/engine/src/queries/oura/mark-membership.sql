UPDATE oura_connections SET status = 'membership_required', updated_at = :now
WHERE user_id = :user_id AND status = 'connected'
RETURNING user_id;
