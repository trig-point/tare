UPDATE oura_connections SET last_synced_at = :now, scores_backfilled_at = coalesce(scores_backfilled_at, :now), status = 'connected', updated_at = :now
WHERE user_id = :user_id AND status != 'reconnect_required'
RETURNING user_id;
